import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

export function withAgentDirectory(t = { after }) {
	const dir = mkdtempSync(join(tmpdir(), "pi-workflow-agent-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}
