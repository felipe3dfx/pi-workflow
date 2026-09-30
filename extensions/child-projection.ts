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

export function childOutcome(child: { id: string; state: string; text?: string }) {
	if (child.state === "completed") return `Child ${child.id} completed:\n\n${child.text ?? ""}`;
	if (child.state === "cancelled") return `Child ${child.id} cancelled.`;
	return `Child ${child.id} ${child.state}: ${child.text ?? ""}`;
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
