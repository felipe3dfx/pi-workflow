import {
	createBlocker,
	sha256Hex,
	type DigestedRef,
	type SkillRequirement,
	type WorkflowBlocker,
} from "./workflow-contracts.ts";

interface SkillRegistryEntry {
	name: string;
	path: string;
	scope: "core" | "project" | "public";
	expectedDigest?: string;
}

export interface SkillResolverDependencies {
	list(): Promise<readonly SkillRegistryEntry[]> | readonly SkillRegistryEntry[];
	readFile(path: string): Promise<string>;
	canonicalPath(path: string): Promise<string> | string;
}

export type SkillResolution =
	| { ok: true; value: readonly DigestedRef[] }
	| { ok: false; blocker: WorkflowBlocker };

const publicWorkflowSkillNames = new Set([
	"define-product",
	"deliver-ticket",
	"qa-handoff",
	"product-review",
]);

export function createSkillResolver(dependencies: SkillResolverDependencies) {
	async function resolve(
		requirements: readonly SkillRequirement[],
	): Promise<SkillResolution> {
		const registry = await dependencies.list();
		const resolved: DigestedRef[] = [];
		for (const requirement of requirements) {
			const matches = registry.filter((entry) => entry.name === requirement.name);
			const project = matches.filter((entry) => entry.scope === "project");
			const core = matches.filter((entry) => entry.scope === "core");
			const publicEntries = matches.filter((entry) => entry.scope === "public");
			if (publicEntries.length > 0 || publicWorkflowSkillNames.has(requirement.name)) {
				return {
					ok: false,
					blocker: createBlocker(
						"PI_WORKFLOW_SKILL_RESOLUTION_FAILED",
						`Public workflow skill ${requirement.name} is not allowed for research intent resolution.`,
					),
				};
			}
			if (project.length > 1 || core.length > 1 || matches.length === 0) {
				return {
					ok: false,
					blocker: createBlocker(
						"PI_WORKFLOW_SKILL_RESOLUTION_FAILED",
						`Exact skill resolution failed for ${requirement.name}.`,
					),
				};
			}
			const selected = project[0] ?? core[0];
			if (!selected) {
				return {
					ok: false,
					blocker: createBlocker(
						"PI_WORKFLOW_SKILL_RESOLUTION_FAILED",
						`Exact skill resolution failed for ${requirement.name}.`,
					),
				};
			}
			if (!selected.path.startsWith("/")) {
				return {
					ok: false,
					blocker: createBlocker(
						"PI_WORKFLOW_SKILL_RESOLUTION_FAILED",
						`Skill ${requirement.name} must resolve to an absolute SKILL.md path.`,
					),
				};
			}
			try {
				const canonicalPath = await dependencies.canonicalPath(selected.path);
				const content = await dependencies.readFile(canonicalPath);
				const digest = sha256Hex(content);
				if (selected.expectedDigest && selected.expectedDigest !== digest) {
					return {
						ok: false,
						blocker: createBlocker(
							"PI_WORKFLOW_SKILL_RESOLUTION_FAILED",
							`Skill ${requirement.name} digest verification failed.`,
						),
					};
				}
				resolved.push({
					kind: "skill",
					name: requirement.name,
					path: canonicalPath,
					digest,
				});
			} catch {
				return {
					ok: false,
					blocker: createBlocker(
						"PI_WORKFLOW_SKILL_RESOLUTION_FAILED",
						`Skill ${requirement.name} is unreadable or stale.`,
					),
				};
			}
		}
		return { ok: true, value: resolved };
	}

	return { resolve };
}
