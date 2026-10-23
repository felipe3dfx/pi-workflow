import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (name) => {
	const index = argv.indexOf(name);
	return index < 0 ? undefined : argv[index + 1];
};
const scenario = process.env.FAKE_PI_SCENARIO ?? "complete";
if (process.env.FAKE_PI_RECORD) {
	writeFileSync(
		process.env.FAKE_PI_RECORD,
		JSON.stringify({ argv, cwd: process.cwd(), pid: process.pid }),
	);
	appendFileSync(`${process.env.FAKE_PI_RECORD}.launches`, `${process.pid}\n`);
}
if (process.env.FAKE_PI_TREE) {
	const tree = process.env.FAKE_PI_TREE;
	const server = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
	const shell = spawn("/bin/sh", ["-c", 'sleep 300 & echo $! >> "$1"; wait', "sh", tree], { detached: true, stdio: "ignore" });
	appendFileSync(tree, `${server.pid}\n${shell.pid}\n`);
	while (readFileSync(tree, "utf8").trim().split("\n").length < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
}
if (scenario === "linger") setInterval(() => {}, 1000);
if (scenario === "refuse") {
	process.stderr.write("fake pi refused to start\n");
	process.exit(3);
}

const [provider, id] = (flag("--model") ?? "/").split("/");
const entries = [];
let steering = [];
let settle;
const write = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const respond = (command, data) =>
	write({ id: command.id, type: "response", command: command.type, success: true, data });
const entry = (message) => {
	const added = { type: "message", id: `e${entries.length + 1}`, message };
	entries.push(added);
};

function run(task) {
	const user = { role: "user", content: [{ type: "text", text: task }] };
	write({ type: "agent_start" });
	write({ type: "message_start", message: user });
	write({ type: "message_end", message: user });
	entry(user);
	if (scenario === "crash") process.exit(7);
	if (scenario === "hang" || scenario === "steer") {
		settle = () => finish("stop", "SETTLED");
		return;
	}
	finish(scenario === "error" ? "error" : "stop", "DONE");
}

function finish(stopReason, text) {
	const start = { role: "assistant", content: [{ type: "text", text: text.slice(0, 2) }], stopReason: "pending" };
	write({ type: "message_start", message: start });
	write({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
	write({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text.slice(0, 2) } });
	write({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text.slice(2) } });
	write({ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 0, content: text } });
	const end = {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason,
		...(stopReason === "error" ? { errorMessage: "provider failed" } : {}),
	};
	write({ type: "message_end", message: end });
	entry(end);
	write({ type: "agent_end", messages: [end], willRetry: false });
	write({ type: "agent_settled", aborted: scenario === "abort-settles" });
}

const handlers = {
	get_state: (command) => {
		if (scenario === "silent") return;
		respond(command, {
			sessionId: scenario === "other-session" ? "other" : flag("--session-id"),
			model: { provider, id: scenario === "other-model" ? "other" : id },
			thinkingLevel: flag("--thinking"),
			isStreaming: false,
		});
	},
	get_entries: (command) => {
		const since = entries.findIndex((item) => item.id === command.since);
		respond(command, { entries: entries.slice(since + 1), leafId: entries.at(-1)?.id ?? null });
	},
	prompt: (command) => {
		respond(command, { disposition: scenario === "handled" ? "handled" : "started" });
		if (scenario !== "handled") run(command.message);
	},
	steer: (command) => {
		steering = [...steering, command.message];
		write({ type: "queue_update", steering, followUp: [] });
		respond(command);
		if (scenario === "steer" && process.env.FAKE_PI_DELIVER === "1") {
			steering = [];
			write({ type: "queue_update", steering, followUp: [] });
			settle?.();
		}
	},
	clear_queue: (command) => {
		respond(command, { steering, followUp: [] });
		steering = [];
	},
	abort: (command) => {
		respond(command);
		if (settle) {
			settle = undefined;
			write({ type: "agent_settled", aborted: true });
		}
	},
	get_last_assistant_text: (command) => {
		const last = entries.findLast((item) => item.message.role === "assistant");
		respond(command, { text: last?.message.content[0].text ?? null });
	},
};

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
		const command = JSON.parse(buffer.slice(0, newline));
		buffer = buffer.slice(newline + 1);
		if (process.env.FAKE_PI_RECORD) appendFileSync(`${process.env.FAKE_PI_RECORD}.commands`, `${command.type}\n`);
		handlers[command.type]?.(command);
	}
});
process.stdin.on("end", () => {
	if (scenario !== "linger") process.exit(0);
});
