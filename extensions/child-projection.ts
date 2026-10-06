import { type Static, Type } from "typebox";

export function childName(child: { role: string; id: string }) {
	return `${child.role} ${child.id.slice(0, 4)}`;
}

export function childElapsed(
	child: { createdAt: number; startedAt?: number; endedAt?: number },
	now: number,
) {
	const seconds = Math.max(
		0,
		Math.floor(
			((child.endedAt ?? now) - (child.startedAt ?? child.createdAt)) / 1000,
		),
	);
	const pad = (value: number) => String(value).padStart(2, "0");
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600)
		return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
	return `${Math.floor(seconds / 3600)}h ${pad(Math.floor(seconds / 60) % 60)}m`;
}

function childTaskLine(task: string) {
	return task.trim().split("\n")[0] ?? "";
}

function childModel(model: string) {
	const slash = model.indexOf("/");
	return slash === -1 ? model : model.slice(slash + 1);
}

export function childModelLine(child: { model: string; thinking?: string }) {
	return child.thinking
		? `${childModel(child.model)} (${child.thinking})`
		: childModel(child.model);
}

export function childStep(child: { step?: string; task: string }) {
	return child.step ?? childTaskLine(child.task);
}

const list = (description: string) =>
	Type.Array(Type.String(), { description });

const reason = Type.Optional(
	Type.String({
		description:
			"One line on why the task reached this Verdict. Required unless the Verdict is done or pass.",
	}),
);

export const resultParameters = {
	worker: Type.Object(
		{
			verdict: Type.Union([
				Type.Literal("done"),
				Type.Literal("partial"),
				Type.Literal("blocked"),
			]),
			reason,
			files_changed: list("Each changed path with its change."),
			validation: list("Each exact command with its observed result."),
			left_undone: list("What remains; empty when nothing does."),
		},
		{ additionalProperties: false },
	),
	verify: Type.Object(
		{
			verdict: Type.Union([
				Type.Literal("pass"),
				Type.Literal("fail"),
				Type.Literal("blocked"),
			]),
			reason,
			findings: list("Each finding with its evidence."),
			unverified: list("What remained unverified."),
		},
		{ additionalProperties: false },
	),
};

export type ChildResult =
	| Static<typeof resultParameters.worker>
	| Static<typeof resultParameters.verify>;

export function reportsResult(
	role: string,
): role is keyof typeof resultParameters {
	return Object.hasOwn(resultParameters, role);
}

export function needsNoReason(
	state: string | undefined,
	verdict: string | undefined,
) {
	return (
		state === "completed" &&
		(verdict === undefined || verdict === "done" || verdict === "pass")
	);
}

export function resultFieldLines({
	verdict: _verdict,
	reason,
	...fields
}: ChildResult) {
	return [
		...(reason ? [`Reason: ${reason}`] : []),
		...Object.entries(fields).flatMap(([field, items]) => [
			`${field}:`,
			...(items.length > 0 ? items : ["none"]).map((item) => `- ${item}`),
		]),
	];
}

function resultLines(result: ChildResult) {
	return [`Verdict: ${result.verdict}.`, ...resultFieldLines(result)].join(
		"\n",
	);
}

export function childOutcome(child: {
	id?: string;
	state: string;
	role: string;
	text?: string;
	result?: ChildResult;
}) {
	const name = child.id ? `Child ${child.id}` : "Child";
	if (child.state === "completed") {
		const verdict = !reportsResult(child.role)
			? ""
			: child.result
				? ` ${resultLines(child.result)}`
				: " Verdict: absent.";
		return `${name} completed.${verdict}\n\n${child.text ?? ""}`;
	}
	if (child.state === "cancelled") return `${name} cancelled.`;
	return `${name} ${child.state}: ${child.text ?? ""}`;
}

export function projectChild(
	record: {
		id: string;
		state: string;
		role: string;
		model: string;
		thinking: string;
		task: string;
		text?: string;
		createdAt: number;
		startedAt?: number;
		endedAt?: number;
	},
	now = Date.now(),
) {
	return {
		id: record.id,
		state: record.state,
		role: record.role,
		model: record.model,
		thinking: record.thinking,
		task: childTaskLine(record.task),
		elapsedMs: (record.endedAt ?? now) - (record.startedAt ?? record.createdAt),
		text: record.text,
		name: childName(record),
		elapsed: childElapsed(record, now),
	};
}
