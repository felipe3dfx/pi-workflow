import { join } from "node:path";
import { pathToFileURL } from "node:url";

const issueId = "ILA-RECOVERY-1";
const digest = "a".repeat(64);
const artifact = { digest, payload: { issue: { id: issueId } } };
const executionBinding = {
	decisionId: "decision-1",
	executionId: "execution-1",
	generation: 1,
	operationDigest: "operation-1",
};

function recoveryContent(binding = executionBinding) {
	return `${JSON.stringify({
		digest,
		executionBinding: binding,
		issueId,
		stage: "verified",
	})}\n`;
}

function seededStore(content) {
	const current = { revision: "seed-r1", content };
	return {
		capabilities: { atomicCompareAndSwap: true },
		readCurrent: async () => current,
		readRevision: async (_project, _topic, revision) =>
			revision === current.revision ? current.content : undefined,
		write: async () => {
			throw new Error("validator seed is read-only");
		},
	};
}

function supersedingStore() {
	const revisions = new Map();
	let current;
	return {
		capabilities: { atomicCompareAndSwap: true },
		readCurrent: async () => current,
		readRevision: async (_project, _topic, revision) => revisions.get(revision),
		write: async (_project, _topic, content) => {
			revisions.set("saved-r1", content);
			current = { revision: "rival-r2", content };
			revisions.set(current.revision, current.content);
			return { revision: "saved-r1" };
		},
	};
}

async function rejects(action) {
	try {
		await action();
		return false;
	} catch {
		return true;
	}
}

async function validateFactory(name, factory, recoversReadBackRace) {
	if (typeof factory !== "function")
		throw new Error("does not export its recovery factory");
	const create = (store) => factory({ project: "pi-workflow", store });
	const valid = create(seededStore(recoveryContent()));
	if (
		!valid ||
		typeof valid.read !== "function" ||
		typeof valid.claim !== "function" ||
		typeof valid.finalizeVerified !== "function"
	)
		throw new Error("factory does not implement the durable recovery contract");
	const state = await valid.read(issueId);
	if (
		state?.digest !== digest ||
		state.stage !== "verified" ||
		JSON.stringify(state.executionBinding) !== JSON.stringify(executionBinding)
	)
		throw new Error("factory rejected canonical execution evidence");

	for (const [field, binding] of [
		["missing executionId", { decisionId: "decision-1", generation: 1, operationDigest: "operation-1" }],
		["malformed executionId", { ...executionBinding, executionId: "" }],
		["missing generation", { decisionId: "decision-1", executionId: "execution-1", operationDigest: "operation-1" }],
		["malformed generation", { ...executionBinding, generation: 0 }],
	]) {
		const recovery = create(seededStore(recoveryContent(binding)));
		if (!(await rejects(() => recovery.read(issueId))))
			throw new Error(`factory accepted ${field}`);
	}

	for (const [operation, invoke] of [
		["claim", (recovery) => recovery.claim(artifact, "owner-1")],
		["finalization", (recovery) => recovery.finalizeVerified(artifact)],
	]) {
		const rejected = await rejects(() => invoke(create(supersedingStore())));
		if (rejected === recoversReadBackRace)
			throw new Error(
				`factory has invalid ${operation} read-back race behavior`,
			);
	}
	return name;
}

export async function validatePublicationRecoveryContract(root, prefix = "") {
	const errors = [];
	try {
		const productReview = await import(
			pathToFileURL(
				join(root, "extensions/product-review-publication-recovery.ts"),
			).href
		);
		const qaHandoff = await import(
			pathToFileURL(join(root, "extensions/qa-handoff-publication-recovery.ts"))
				.href
		);
		for (const [name, factory, recoversReadBackRace] of [
			[
				"product-review",
				productReview.createProductReviewPublicationRecoveryStore,
				true,
			],
			[
				"qa-handoff",
				qaHandoff.createQaHandoffPublicationRecoveryStore,
				false,
			],
		]) {
			try {
				await validateFactory(name, factory, recoversReadBackRace);
			} catch (error) {
				errors.push(
					`${prefix}${name} publication recovery contract failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	} catch (error) {
		errors.push(
			`${prefix}publication recovery contract could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return errors;
}
