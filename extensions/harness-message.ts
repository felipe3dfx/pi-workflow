const messages = new WeakSet<object>();

export function harnessMessage<T extends object>(tool: T): T {
	messages.add(tool);
	return tool;
}

export function isHarnessMessage(tool: object) {
	return messages.has(tool);
}
