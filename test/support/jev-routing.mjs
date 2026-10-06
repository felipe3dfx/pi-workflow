import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

import { createJevRouting } from "../../extensions/workflow-settings.ts";

export function withAgentDirectory(t = { after }) {
	const dir = mkdtempSync(join(tmpdir(), "pi-workflow-agent-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

export function turnJevRoutingOn(dir = withAgentDirectory()) {
	writeFileSync(
		join(dir, "pi-workflow-routing.json"),
		JSON.stringify({ schemaVersion: 1, jevRouting: "on" }),
	);
	return createJevRouting(dir);
}
