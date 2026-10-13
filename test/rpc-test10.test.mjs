import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const live = process.env.PI_WORKFLOW_RPC_TEST10 === "1";
const deadlineMs = 110_000;
const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME, ".pi", "agent");
const bridge = join(agentDir, "npm", "node_modules", "pi-claude-bridge", "src", "index.ts");
const intercom = join(agentDir, "npm", "node_modules", "pi-intercom", "index.ts");

test("TEST10: real Bridge parent receives configured child via RPC", {
	skip: !live && "Set PI_WORKFLOW_RPC_TEST10=1 to run the one-invocation real Pi RPC delivery check.",
	timeout: deadlineMs + 10_000,
}, async () => {
	const scratch = await mkdtemp(join(tmpdir(), "pi-workflow-rpc-test10-"));
	const log = join(scratch, "events.jsonl");
	const command = process.env.PI_WORKFLOW_RPC_TEST10_BIN ?? "pi";
	const args = [
		"--mode", "rpc", "--no-extensions",
		"--extension", join(repo, "extensions", "pi-workflow.ts"),
		"--extension", bridge,
		"--extension", intercom,
		"--extension", "builtin:codemode",
		"--extension", "builtin:mcp",
		"--no-context-files", "--no-skills", "--no-session",
		"--model", "claude-bridge/claude-haiku-4-5",
	];
	const child = spawn(command, args, { cwd: repo, stdio: ["pipe", "pipe", "pipe"], detached: true });
	const events = [];
	let writeChain = Promise.resolve();
	let stdout = "";
	let stderr = "";
	let ended = false;
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
		let newline = stdout.indexOf("\n");
		while (newline >= 0) {
			const line = stdout.slice(0, newline).replace(/\r$/, "");
			stdout = stdout.slice(newline + 1);
			newline = stdout.indexOf("\n");
			if (!line) continue;
			try {
				const event = JSON.parse(line);
				events.push(event);
				writeChain = writeChain.then(() => appendFile(log, `${JSON.stringify(event)}\n`));
			} catch {
				writeChain = writeChain.then(() => appendFile(log, `${JSON.stringify({ parseError: line })}\n`));
			}
		}
	});
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.on("close", () => { ended = true; });
	await appendFile(log, `${JSON.stringify({ kind: "invocation", command, args, cwd: repo, piAgentDir: agentDir })}\n`);
	let timer;
	let ready;
	let poll;
	let scan;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`TEST10 RPC deadline ${deadlineMs}ms exceeded`)), deadlineMs);
	});
	let evidence;
	try {
		await new Promise((resolve, reject) => {
			const started = Date.now();
			ready = setInterval(() => {
				if (events.some((event) => event.type === "response" && event.command === "get_state")) {
					clearInterval(ready);
					resolve();
				} else if (ended || Date.now() - started > 20_000) {
					clearInterval(ready);
					reject(new Error(`Pi RPC did not become ready; stderr=${stderr}`));
				}
			}, 25);
			child.stdin.write(`${JSON.stringify({ id: "test10-state", type: "get_state" })}\n`);
			poll = setInterval(() => {
				if (events.some((event) => event.type === "response" && event.id === "test10-state")) {
					clearInterval(poll);
					child.stdin.write(`${JSON.stringify({ id: "test10-prompt", type: "prompt", message: "Use spawn_child exactly once with role explore. Ask the child to choose a fresh token matching CHILD_EVIDENCE_[A-Z0-9]{8}, then return only that token in its final result. The child must do no repository reads, commands, writes, or other actions. After the child is queued, end your turn without polling or returning a token. When the child's terminal result wakes you, reply with exactly the token from that result and do not call another tool." })}\n`);
				}
			}, 25);
		});

		await Promise.race([new Promise((resolve, reject) => {
			scan = setInterval(() => {
				const starts = events.filter((event) => event.type === "tool_execution_start" && event.toolName === "spawn_child");
				const results = events.filter((event) => event.type === "tool_execution_end" && event.toolName === "spawn_child");
				const assistantMessages = events.filter((event) => event.type === "message_end" && event.message?.role === "assistant");
				const text = assistantMessages.flatMap((event) => event.message.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
				const token = text.match(/CHILD_EVIDENCE_[A-Z0-9]{8}/)?.[0];
				const call = starts[0];
				const queued = results.find((event) => event.toolCallId === call?.toolCallId && event.isError === false && event.result?.details?.status === "queued");
				const childId = queued?.result?.details?.id;
				const terminalIndex = childId && events.findIndex((event) => event.type === "message_end" && event.message?.role === "custom" && event.message.customType === "pi-workflow-child-result" && event.message.details?.id === childId && event.message.details?.state === "completed");
				const terminal = terminalIndex >= 0 ? events[terminalIndex] : undefined;
				const queuedIndex = queued ? events.indexOf(queued) : -1;
				const waitTurnEndIndex = terminalIndex > queuedIndex ? events.slice(queuedIndex + 1, terminalIndex).findLastIndex((event) => event.type === "turn_end" && event.message?.role === "assistant") + queuedIndex + 1 : -1;
				const waitingAssistant = waitTurnEndIndex >= 0 ? events.slice(queuedIndex + 1, waitTurnEndIndex).findLast((event) => event.type === "message_end" && event.message?.role === "assistant") : undefined;
				const resultTurnStartIndex = terminalIndex > waitTurnEndIndex ? events.slice(waitTurnEndIndex + 1, terminalIndex).findIndex((event) => event.type === "turn_start") + waitTurnEndIndex + 1 : -1;
				const followUp = token && assistantMessages.find((event, index) => index > 0 && JSON.stringify(event).includes(token) && events.indexOf(event) > terminalIndex);
				const followUpIndex = followUp ? events.indexOf(followUp) : -1;
				const settled = followUpIndex >= 0 ? events.find((event, index) => index > followUpIndex && event.type === "agent_settled") : undefined;
				if (queued && terminal && waitingAssistant && waitTurnEndIndex > queuedIndex && resultTurnStartIndex > waitTurnEndIndex && followUp && settled) {
					clearInterval(scan);
					evidence = { starts, queued, childId, terminal, token, waitingAssistant, waitingTurnEnd: events[waitTurnEndIndex], resultTurnStart: events[resultTurnStartIndex], followUp, settled };
					resolve();
				} else if (ended) {
					clearInterval(scan);
					reject(new Error("Pi RPC exited before full child-result/follow-up chain"));
				}
			}, 50);
		}), timeout]);
	} catch (error) {
		await appendFile(log, `${JSON.stringify({ kind: "failure", error: String(error), stderr, observed: events.length })}\n`);
		throw new Error(`${error}; JSONL=${log}; stderr=${stderr}`);
	} finally {
		clearTimeout(timer);
		clearInterval(ready);
		clearInterval(poll);
		clearInterval(scan);
		if (!ended) {
			child.stdin.end();
			const exited = new Promise((resolve) => child.once("close", resolve));
			await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
			if (!ended) {
				try { process.kill(-child.pid, "SIGTERM"); } catch {}
				await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
			}
			if (!ended) {
				try { process.kill(-child.pid, "SIGKILL"); } catch {}
				await exited;
			}
		}
	}
	await writeChain;
	assert.equal(events.filter((event) => event.type === "tool_execution_start" && event.toolName === "spawn_child").length, 1);
	assert.equal(events.filter((event) => event.type === "tool_execution_end" && event.toolName === "spawn_child" && event.toolCallId === evidence.queued.toolCallId).length, 1);
	assert.match(evidence.token, /^CHILD_EVIDENCE_[A-Z0-9]{8}$/);
	assert.equal(evidence.terminal.message.details.text, evidence.token, "the custom terminal result carries the child-produced token");
	assert.ok(evidence.childId, "terminal result identifies the queued child");
	const userPrompts = events.filter((event) => event.type === "message_end" && event.message?.role === "user");
	assert.ok(!JSON.stringify(userPrompts).includes(evidence.token), "the child evidence did not occur in any user prompt");
	const queuedIndex = events.indexOf(evidence.queued);
	const waitingAssistantIndex = events.indexOf(evidence.waitingAssistant);
	const waitingTurnEndIndex = events.indexOf(evidence.waitingTurnEnd);
	const resultTurnStartIndex = events.indexOf(evidence.resultTurnStart);
	const terminalIndex = events.indexOf(evidence.terminal);
	const followUpIndex = events.indexOf(evidence.followUp);
	const settledIndex = events.indexOf(evidence.settled);
	assert.ok(queuedIndex < waitingAssistantIndex && waitingAssistantIndex < waitingTurnEndIndex && waitingTurnEndIndex < resultTurnStartIndex && resultTurnStartIndex < terminalIndex && terminalIndex < followUpIndex && followUpIndex < settledIndex, "the queued result is delivered on the continuing public RPC turn and followed by the final settled event");
	assert.equal(evidence.waitingAssistant.message.provider, "claude-bridge");
	assert.equal(evidence.waitingAssistant.message.model, "claude-haiku-4-5");
	assert.equal(evidence.followUp.message.provider, "claude-bridge");
	assert.equal(evidence.followUp.message.model, "claude-haiku-4-5");
	assert.equal(evidence.terminal.message.details.model, "openai-codex/gpt-6-luna");
	assert.equal(evidence.terminal.message.details.thinking, "high");
	assert.equal(evidence.followUp.message.content.filter((part) => part.type === "text").map((part) => part.text).join(""), evidence.token, "the next assistant response is exactly the token from the child result");
	console.log(JSON.stringify({ TEST10: "PASS", invocation: [command, ...args], cwd: repo, log, childId: evidence.childId, toolCallId: evidence.queued.toolCallId, token: evidence.token, orderedChain: ["queued", "parent assistant/turn_end", "next turn_start", "completed custom result", "follow-up assistant", "agent_settled"], parent: { provider: evidence.followUp.message.provider, model: evidence.followUp.message.model }, child: { model: evidence.terminal.message.details.model, thinking: evidence.terminal.message.details.thinking } }));
});
