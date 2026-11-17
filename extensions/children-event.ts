// Shared extension event bus contract: another extension, such as a terminal status reporter, can show the parent
// as working while background children run after the parent ends its turn.
export const childrenEvent = "workflow:children";

export type ChildrenEvent = { working: number };

// Emits the count of working children once at session start, then only when it changes, and resets it to zero when the
// session ends. Between an end and the next start nothing is emitted.
export function createChildrenSignal(
	working: () => number,
	emit: (event: ChildrenEvent) => void,
) {
	let last: number | undefined;
	function send(count: number) {
		last = count;
		emit({ working: count });
	}
	return {
		start() {
			send(working());
		},
		changed() {
			if (last === undefined) return;
			const count = working();
			if (count !== last) send(count);
		},
		end() {
			if (last !== undefined && last > 0) emit({ working: 0 });
			last = undefined;
		},
	};
}
