export function manualClock() {
	const timers = new Set();
	return {
		schedule: (fn, ms) => {
			const timer = { fn, ms };
			timers.add(timer);
			return () => timers.delete(timer);
		},
		pending: () => [...timers].map((timer) => timer.ms),
		fire(ms) {
			const fired = [];
			for (const timer of [...timers]) {
				if (timer.ms !== ms) continue;
				timers.delete(timer);
				fired.push(timer.fn());
			}
			return Promise.all(fired);
		},
	};
}
