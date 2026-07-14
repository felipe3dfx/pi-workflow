import {
	createBlocker,
	sha256Hex,
	type DigestedRef,
	type ProjectRef,
	type SkillRequirement,
	type WorkflowBlocker,
} from "./workflow-contracts.ts";

interface StandardsSourceEntry {
	name: string;
	path: string;
	content: string;
	required?: boolean;
	expectedDigest?: string;
}

interface PathOverlayEntry extends StandardsSourceEntry {
	pathPrefixes: readonly string[];
}

interface StandardsSnapshot {
	instructions: readonly StandardsSourceEntry[];
	context?: StandardsSourceEntry;
	adrs?: readonly StandardsSourceEntry[];
	overlays?: readonly PathOverlayEntry[];
	requiredSkills?: readonly SkillRequirement[];
}

export interface ProjectStandardsDependencies {
	load(project: ProjectRef): Promise<StandardsSnapshot> | StandardsSnapshot;
}

export type ProjectStandardsResolution =
	| {
			ok: true;
			value: {
				standardRefs: readonly DigestedRef[];
				requiredSkills: readonly SkillRequirement[];
			};
	  }
	| { ok: false; blocker: WorkflowBlocker };

export function createProjectStandardsResolver(
	dependencies: ProjectStandardsDependencies,
) {
	async function resolve(input: {
		project: ProjectRef;
		affectedPaths: readonly string[];
	}): Promise<ProjectStandardsResolution> {
		const snapshot = await dependencies.load(input.project);
		const selected: StandardsSourceEntry[] = [
			...snapshot.instructions,
			...(snapshot.context ? [snapshot.context] : []),
			...(snapshot.adrs ?? []),
		];
		for (const overlay of snapshot.overlays ?? []) {
			const matches = input.affectedPaths.some((path) =>
				overlay.pathPrefixes.some((prefix) => path.startsWith(prefix)),
			);
			if (matches) selected.push(overlay);
		}
		const uniqueByPath = new Map<string, DigestedRef>();
		for (const entry of selected) {
			if (!entry.path.startsWith("/")) {
				return {
					ok: false,
					blocker: createBlocker(
						"PI_WORKFLOW_STANDARDS_RESOLUTION_FAILED",
						`Standard ${entry.name} must resolve to an absolute path.`,
					),
				};
			}
			if (!entry.content && entry.required !== false) {
				return {
					ok: false,
					blocker: createBlocker(
						"PI_WORKFLOW_STANDARDS_RESOLUTION_FAILED",
						`Required standard ${entry.name} is missing.`,
					),
				};
			}
			const digest = sha256Hex(entry.content);
			if (entry.expectedDigest && entry.expectedDigest !== digest) {
				return {
					ok: false,
					blocker: createBlocker(
						"PI_WORKFLOW_STANDARDS_RESOLUTION_FAILED",
						`Standard ${entry.name} digest verification failed.`,
					),
				};
			}
			uniqueByPath.set(entry.path, {
				kind: "standard",
				name: entry.name,
				path: entry.path,
				digest,
			});
		}
		const standardRefs = [...uniqueByPath.values()].sort((left, right) =>
			left.path.localeCompare(right.path),
		);
		return {
			ok: true,
			value: {
				standardRefs,
				requiredSkills: [...(snapshot.requiredSkills ?? [])],
			},
		};
	}

	return { resolve };
}
