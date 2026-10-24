import { execFileSync } from "node:child_process";

import { installedPi } from "../../extensions/rpc-child.ts";

function resolved() {
	try {
		return installedPi();
	} catch {
		return undefined;
	}
}

export const pi = resolved();
export const piVersion = pi && execFileSync(pi, ["--version"], { encoding: "utf8" }).trim();
export const piSkip =
	!pi && "Pi is not installed on PATH outside node_modules/.bin, so the real-binary RPC child checks cannot run.";
