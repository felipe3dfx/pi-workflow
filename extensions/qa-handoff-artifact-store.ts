import { canonicalJson } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";
import {
	isQaHandoffArtifact,
	type QaHandoffArtifact,
	type QaHandoffArtifactStore,
} from "./qa-handoff-workflow.ts";

function parse(content: string, issueId: string): QaHandoffArtifact {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		throw new Error("The QA handoff artifact is not valid JSON.");
	}
	if (!isQaHandoffArtifact(value, issueId))
		throw new Error("The QA handoff artifact is invalid or corrupt.");
	if (content !== `${canonicalJson(value)}\n`)
		throw new Error("The QA handoff artifact bytes are not canonical JSON plus newline.");
	return value;
}

export function createQaHandoffArtifactStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string;
	readonly topic?: string;
}): QaHandoffArtifactStore {
	const prefix = options.topic ?? "workflow/qa-handoff";
	const destination = (issueId: string) => `${prefix}/${issueId}`;

	return {
		async read(issueId) {
			const topic = destination(issueId);
			const current = await options.store.readCurrent(options.project, topic);
			if (!current) return undefined;
			const readBack = await options.store.readRevision(
				options.project,
				topic,
				current.revision,
			);
			if (readBack !== current.content)
				throw new Error("The QA handoff artifact read-back did not match.");
			return structuredClone(parse(current.content, issueId));
		},
		async save(artifact) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error("Atomic compare-and-swap is required for QA handoff artifacts.");
			if (!isQaHandoffArtifact(artifact, artifact.payload.issue.id))
				throw new Error("The QA handoff artifact is invalid or corrupt.");
			const topic = destination(artifact.payload.issue.id);
			const content = `${canonicalJson(artifact)}\n`;
			const current = await options.store.readCurrent(options.project, topic);
			if (current) {
				parse(current.content, artifact.payload.issue.id);
				if (current.content !== content)
					throw new Error("The QA handoff artifact conflicts with its create-only snapshot.");
				const readBack = await options.store.readRevision(
					options.project,
					topic,
					current.revision,
				);
				if (readBack !== content)
					throw new Error("The QA handoff artifact read-back did not match.");
				return structuredClone(artifact);
			}
			const { revision } = await options.store.write(
				options.project,
				topic,
				content,
				undefined,
			);
			const readBack = await options.store.readRevision(
				options.project,
				topic,
				revision,
			);
			if (readBack !== content)
				throw new Error("The QA handoff artifact read-back did not match.");
			return structuredClone(parse(content, artifact.payload.issue.id));
		},
	};
}
