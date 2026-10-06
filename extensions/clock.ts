export type Schedule = (run: () => void, ms: number) => () => void;

export const scheduleTimer: Schedule = (run, ms) => {
	const timer = setTimeout(run, ms);
	timer.unref();
	return () => clearTimeout(timer);
};
