import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";

const scratch = process.argv[2] === "queue-child" ? process.argv[3] : mkdtempSync(join(tmpdir(), "fleet-parity-"));
process.env.PI_CODING_AGENT_DIR = join(scratch, "agent");
process.env.PI_OFFLINE = "1";
const { withFileMutationQueue } = await import("@earendil-works/pi-coding-agent");
const file = join(scratch, "counter.json");
if (process.argv[2] === "queue-child") {
	await withFileMutationQueue(file, async () => {
		const value = JSON.parse(readFileSync(file, "utf8"));
		const released = new Promise((resolve) => process.once("message", resolve));
		process.send({ read: value });
		await released;
		writeFileSync(file, JSON.stringify(value + 1));
	});
	process.disconnect();
} else {
	const owned = [];
	const deadline = setTimeout(() => { for (const child of owned) child.kill("SIGTERM"); }, 20000);
	try {
		mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
		writeFileSync(file, "0");
		await Promise.all([0, 1].map(() => withFileMutationQueue(file, async () => {
			const value = JSON.parse(readFileSync(file, "utf8"));
			await delay(25);
			writeFileSync(file, JSON.stringify(value + 1));
		})));
		const inProcess = JSON.parse(readFileSync(file, "utf8"));
		assert.equal(inProcess, 2);
		writeFileSync(file, "0");
		const readers = [0, 1].map(() => {
			const child = fork(fileURLToPath(import.meta.url), ["queue-child", scratch], { env: { PATH: process.env.PATH, HOME: scratch, PI_OFFLINE: "1" }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
			owned.push(child);
			const read = new Promise((resolve, reject) => {
				child.once("message", resolve);
				child.once("exit", (code) => { if (code !== 0) reject(new Error(`Queue child exited ${code}`)); });
			});
			const exit = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
			return { child, read, exit };
		});
		const reads = await Promise.all(readers.map((reader) => reader.read));
		assert.deepEqual(reads, [{ read: 0 }, { read: 0 }]);
		for (const reader of readers) reader.child.send("release");
		assert.deepEqual(await Promise.all(readers.map((reader) => reader.exit)), [0, 0]);
		const crossProcess = JSON.parse(readFileSync(file, "utf8"));
		assert.equal(crossProcess, 1);

		const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
		const extension = fileURLToPath(new URL("./broker-extension.mjs", import.meta.url));
		const rpc = spawn(process.execPath, [cli, "--mode", "rpc", "--offline", "--no-session", "--no-extensions", "--extension", extension, "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--tools", "ask_parent,report_result,bash,codegraph", "--provider", "broker-fixture", "--model", "local"], { cwd: scratch, env: { PATH: process.env.PATH, HOME: scratch, LANG: "C.UTF-8", PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "pipe"] });
		owned.push(rpc);
		let stderr = "";
		rpc.stderr.on("data", (data) => { stderr += data; });
		const exited = new Promise((resolve) => rpc.once("exit", (code) => resolve(code)));
		const records = [];
		let lastReport;
		const pending = new Map();
		const waiters = [];
		const send = (record) => rpc.stdin.write(`${JSON.stringify(record)}\n`);
		let id = 0;
		const command = (type, fields = {}) => new Promise((resolve, reject) => {
			const key = `fixture-${++id}`;
			pending.set(key, { resolve, reject });
			send({ id: key, type, ...fields });
		});
		const waitFor = (predicate) => new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("Fixture event deadline exceeded")), 6000);
			waiters.push({ predicate, resolve: (value) => { clearTimeout(timer); resolve(value); } });
		});
		const decoder = new StringDecoder("utf8");
		let buffer = "";
		const onLine = (line) => {
			const record = JSON.parse(line);
			records.push(record);
			if (record.type === "extension_ui_request" && record.message?.startsWith("fixture-report:")) lastReport = JSON.parse(record.message.slice("fixture-report:".length));
			if (record.type === "response") {
				const promise = pending.get(record.id);
				pending.delete(record.id);
				if (record.success) promise?.resolve(record.data); else promise?.reject(new Error(record.error));
			}
			for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].predicate(record)) waiters.splice(i, 1)[0].resolve(record);
		};
		rpc.stdout.on("data", (data) => {
			buffer += decoder.write(data);
			let boundary = buffer.indexOf("\n");
			while (boundary !== -1) {
				const line = buffer.slice(0, boundary).replace(/\r$/, "");
				buffer = buffer.slice(boundary + 1);
				onLine(line);
				boundary = buffer.indexOf("\n");
			}
		});
		rpc.stdin.on("error", (error) => { for (const promise of pending.values()) promise.reject(error); });
		rpc.once("exit", () => { for (const promise of pending.values()) promise.reject(new Error(`RPC exited: ${stderr}`)); });
		await command("get_state");
		await command("set_auto_compaction", { enabled: false });
		await command("set_auto_retry", { enabled: false });
		let settled = waitFor((record) => record.type === "agent_settled");
		let question = waitFor((record) => record.type === "extension_ui_request" && record.method === "input");
		await command("prompt", { message: "normal" });
		const request = await question;
		send({ type: "extension_ui_response", id: request.id, value: "fixture-parent-reply" });
		await settled;
		const normalEnds = records.filter((record) => record.type === "tool_execution_end");
		assert.equal(normalEnds.length, 5, stderr);
		assert.equal(normalEnds[0].isError, false);
		assert.ok(normalEnds[1].result.content.some((block) => block.text?.includes("fixture bash")));
		assert.equal(normalEnds[2].isError, true);
		const reports = records.filter((record) => record.type === "extension_ui_request" && record.message?.startsWith("fixture-report:")).map((record) => JSON.parse(record.message.slice("fixture-report:".length)));
		assert.deepEqual(reports, [{ verdict: "partial", reason: "first report", files_changed: [], validation: [], left_undone: ["fixture pending"] }, { verdict: "done", files_changed: [], validation: [], left_undone: [] }]);
		assert.deepEqual(lastReport, reports.at(-1));
		const cancelStart = records.length;
		settled = waitFor((record) => record.type === "agent_settled");
		question = waitFor((record) => record.type === "extension_ui_request" && record.method === "input");
		await command("prompt", { message: "cancel" });
		await question;
		await command("steer", { message: "fixture pending steer" });
		const cleared = await command("clear_queue");
		assert.deepEqual(cleared.steering, ["fixture pending steer"]);
		await command("abort");
		await settled;
		const cancelRecords = records.slice(cancelStart);
		assert.ok(cancelRecords.some((record) => record.type === "tool_execution_end" && record.isError));
		assert.ok(!cancelRecords.some((record) => record.type === "message_end" && record.message.content?.some((block) => block.text === "unexpected continuation")));
		rpc.stdin.end();
		assert.equal(await exited, 0, stderr);
		process.stdout.write(`${JSON.stringify({ queue: { inProcess, crossProcess, barrierReads: reads, expectedWithoutLostUpdate: 2 }, rpc: { normalToolResults: normalEnds.map(({ toolName, isError, result }) => ({ toolName, isError, result })), reports, lastReport, cleared, cancellation: "pending question aborted; no provider continuation", recordTypes: cancelRecords.map((record) => record.type), stderr } }, null, 2)}\n`);
	} finally {
		clearTimeout(deadline);
		for (const child of owned) if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGTERM");
			await new Promise((resolve) => {
				const timer = setTimeout(() => { child.kill("SIGKILL"); }, 2000);
				child.once("exit", () => { clearTimeout(timer); resolve(); });
			});
		}
		rmSync(scratch, { recursive: true, force: true });
	}
}
