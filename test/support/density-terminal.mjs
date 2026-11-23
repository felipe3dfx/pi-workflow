import { setDensityTerminal } from "../../extensions/visual-language.ts";

export function densityTerminal(t, columns) {
	const terminal = { columns };
	setDensityTerminal(terminal);
	t.after(() => setDensityTerminal(undefined));
	return terminal;
}
