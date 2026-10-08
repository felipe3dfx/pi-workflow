import { createChildSessions } from "../../extensions/child-sessions.ts";

export function userEntry(id, text) {
	return { type: "message", id, message: { role: "user", content: text } };
}

export function fakeChildren({ model, thinking, tools, run, dispose, onCreate } = {}) {
	const created = [];
	const create = async (spec) => {
		await onCreate?.();
		const child = {
			spec,
			tasks: [],
			aborts: 0,
			disposals: 0,
			result: Promise.withResolvers(),
			entries: [userEntry(`entry-${created.length}`, spec.prompt)],
			steered: [],
			queue: [],
			deliver() {
				const text = child.queue.shift();
				queued();
				spec.onEvent({
					type: "message_start",
					message: { role: "user", content: [{ type: "text", text }] },
				});
			},
		};
		const queued = () =>
			spec.onEvent({
				type: "queue_update",
				steering: [...child.queue],
				followUp: [],
			});
		created.push(child);
		return {
			sessionId: `session-${created.length - 1}`,
			entries: () => child.entries,
			model: model ?? spec.model,
			thinking: thinking ?? spec.thinking,
			tools: tools ?? spec.tools,
			run: async (task) => {
				child.tasks.push(task);
				return run ? run(task, child.spec) : child.result.promise;
			},
			steer: async (text) => {
				child.steered.push(text);
				child.queue.push(text);
				queued();
			},
			clearQueue: () => {
				const steering = child.queue;
				child.queue = [];
				queued();
				return steering;
			},
			abort: async () => {
				child.aborts += 1;
			},
			dispose: async () => {
				child.disposals += 1;
				await dispose?.(child);
			},
		};
	};
	return { create, created };
}

export function recordingCore({
	failures = 0,
	idle = false,
	schedule = () => () => {},
} = {}) {
	const children = fakeChildren();
	const sent = [];
	const reports = [];
	const core = createChildSessions({
		create: children.create,
		send(message) {
			if (failures > 0) {
				failures -= 1;
				throw new Error("transport closed");
			}
			sent.push(message);
		},
		idle: () => idle,
		trace() {},
		report: (message) => reports.push(message),
		schedule,
	});
	async function launch(role = "worker") {
		const started = await core.start(
			{
				role,
				contract: { prompt: "Contract", tools: [] },
				task: "Fix the failing test",
				worktree: "/tmp",
				model: "p/m",
				thinking: "medium",
				chosenBy: "parent",
				references: [],
			},
			{
				background: true,
				modelRegistry: {},
				project: () => ({ cwd: "/tmp", trusted: false }),
				shell: () => ({}),
			},
		);
		await new Promise((resolve) => setImmediate(resolve));
		return { id: started.id, child: children.created.at(-1) };
	}
	return {
		core,
		sent,
		reports,
		launch,
		failNext(count = 1) {
			failures = count;
		},
	};
}
