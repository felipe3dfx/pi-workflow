import { createHash, randomUUID } from "node:crypto";

import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

type CanonicalValue =
	| null
	| boolean
	| number
	| string
	| readonly CanonicalValue[]
	| { readonly [key: string]: CanonicalValue };

export interface DecisionScope {
	readonly project: string;
	readonly workflow: string;
	readonly subject: string;
}

export interface AuthenticatedDecisionActor {
	readonly actorId: string;
	readonly authorityRevision: string;
	readonly active: true;
	readonly guest: false;
}

interface DurableDecisionActor {
	readonly actorId: string;
	readonly authorityRevision: string;
}

export interface TypedDecisionAction {
	readonly id: string;
	readonly input: CanonicalValue;
}

interface DecisionChoice {
	readonly id: string;
	readonly mode: "execute" | "cancel";
	readonly action: TypedDecisionAction;
	readonly label: string;
	readonly description: string;
}

export interface DecisionRequest {
	readonly scope: DecisionScope;
	readonly operation: {
		readonly kind: string;
		readonly phase: string;
		readonly input: CanonicalValue;
		readonly artifacts: readonly CanonicalValue[];
		readonly targets: readonly CanonicalValue[];
		readonly evidence: readonly CanonicalValue[];
	};
	readonly presentation: {
		readonly locale: string;
		readonly summary: string;
		readonly details: readonly string[];
		readonly consequences: readonly string[];
		readonly risks: readonly string[];
		readonly choices: readonly DecisionChoice[];
	};
}

export interface DecisionPresentation {
	readonly decisionId: string;
	readonly summary: string;
	readonly details: readonly string[];
	readonly consequences: readonly string[];
	readonly risks: readonly string[];
	readonly choices: readonly {
		readonly id: string;
		readonly mode: DecisionChoice["mode"];
		readonly actionId: string;
		readonly label: string;
		readonly description: string;
	}[];
}

interface ExecutionBinding {
	readonly decisionId: string;
	readonly operationDigest: string;
	readonly executionId: string;
	readonly generation: number;
}

export interface ExecutionLease extends ExecutionBinding {
	readonly actorId: string;
	readonly authorityRevision: string;
	readonly action: TypedDecisionAction;
}

interface ExecutionManifestBinding extends ExecutionBinding {
	readonly ref: string;
}

export interface DecisionBlocker {
	readonly code:
		| "PI_WORKFLOW_DECISION_NOT_FOUND"
		| "PI_WORKFLOW_DECISION_ACTION_MISMATCH"
		| "PI_WORKFLOW_DECISION_CLAIM_MISSING"
		| "PI_WORKFLOW_DECISION_ACTOR_MISMATCH"
		| "PI_WORKFLOW_DECISION_REPLAY"
		| "PI_WORKFLOW_DECISION_CAS_CONFLICT"
		| "PI_WORKFLOW_DECISION_MANIFEST_CONFLICT";
	readonly message: string;
}

type DecisionErrorCode =
	| DecisionBlocker["code"]
	| "PI_WORKFLOW_DECISION_REQUEST_INVALID"
	| "PI_WORKFLOW_DECISION_CANCEL_REQUIRED"
	| "PI_WORKFLOW_DECISION_STATE_CORRUPT"
	| "PI_WORKFLOW_DECISION_SCHEMA_UNSUPPORTED"
	| "PI_WORKFLOW_DECISION_STORE_UNAVAILABLE"
	| "PI_WORKFLOW_DECISION_READBACK_MISMATCH";

export type DecisionReceipt =
	| {
			readonly state: "leased";
			readonly decisionId: string;
			readonly actionId: string;
			readonly actorId: string;
			readonly executionId: string;
			readonly generation: number;
	  }
	| {
			readonly state: "cancelled";
			readonly decisionId: string;
			readonly actionId: "decision.cancel";
			readonly actorId: string;
	  }
	| { readonly state: "superseded"; readonly decisionId: string };

export type AuthorizationOutcome =
	| {
			readonly kind: "authorized";
			readonly lease: ExecutionLease;
			readonly receipt: Extract<DecisionReceipt, { state: "leased" }>;
	  }
	| {
			readonly kind: "cancelled";
			readonly decisionId: string;
			readonly receipt: Extract<DecisionReceipt, { state: "cancelled" }>;
	  }
	| { readonly kind: "blocked"; readonly blocker: DecisionBlocker };

export type RecoveryOutcome =
	| { readonly kind: "none" }
	| { readonly kind: "prepared"; readonly decisionId: string }
	| {
			readonly kind: "authorized";
			readonly lease: ExecutionLease;
			readonly receipt: Extract<DecisionReceipt, { state: "leased" }>;
			readonly manifest?: ExecutionManifestBinding;
	  }
	| {
			readonly kind: "cancelled";
			readonly decisionId: string;
			readonly receipt: Extract<DecisionReceipt, { state: "cancelled" }>;
	  }
	| {
			readonly kind: "superseded";
			readonly decisionId: string;
			readonly receipt: Extract<DecisionReceipt, { state: "superseded" }>;
	  }
	| {
			readonly kind: "active";
			readonly decisionId: string;
			readonly executionId: string;
			readonly generation: number;
			readonly currentApprover: DurableDecisionActor;
			readonly reapprovalRequired: true;
			readonly actions: readonly ["resume", "replace", "cancel"];
	  }
	| {
			readonly kind: "terminal";
			readonly decisionId: string;
			readonly state: string;
			readonly currentApprover: DurableDecisionActor;
	  }
	| {
			readonly kind: "drift";
			readonly presentation: DecisionPresentation;
			readonly diff: HumanDecisionDiff;
	  }
	| {
			readonly kind: "reapproval";
			readonly previousDecisionId: string;
			readonly presentation: DecisionPresentation;
	  }
	| { readonly kind: "blocked"; readonly blocker: DecisionBlocker };

interface HumanDecisionDiff {
	readonly summary: string;
	readonly details: readonly string[];
}

export type RecoveryDirective =
	| { readonly kind: "resume"; readonly request?: DecisionRequest }
	| { readonly kind: "cancel" }
	| { readonly kind: "replace"; readonly request: DecisionRequest }
	| {
			readonly kind: "drift";
			readonly request: DecisionRequest;
			readonly diff: HumanDecisionDiff;
	  }
	| { readonly kind: "terminal"; readonly state: string };

type PreparationMode =
	| { readonly kind: "normal" }
	| { readonly kind: "replace"; readonly actor: DurableDecisionActor }
	| {
			readonly kind: "reapprove";
			readonly actor: DurableDecisionActor;
			readonly priorDecisionId: string;
			readonly generation: number;
	  };

interface DecisionStoreRead {
	readonly revision: string;
	readonly content: string;
}

export interface DecisionStore {
	read(key: string): Promise<DecisionStoreRead | undefined>;
	readRevision(key: string, revision: string): Promise<string | undefined>;
	compareAndSwap(
		key: string,
		expectedRevision: string | null,
		content: string,
	): Promise<{ readonly revision: string }>;
}

export interface DecisionClaimSource {
	/** Transport-neutral by design; adapters must clear private claims at their session boundary. */
	consume(
		decisionId: string,
		action: TypedDecisionAction,
		actor: AuthenticatedDecisionActor,
	): Promise<boolean>;
}

interface ManifestLookup {
	find(lease: ExecutionLease): Promise<readonly ExecutionManifestBinding[]>;
}

type DecisionState =
	| "prepared"
	| "approved"
	| "leased"
	| "cancelled"
	| "superseded"
	| "cancellation-tombstone"
	| "revoked"
	| "terminal";

interface DurableActionBinding {
	id: string;
	mode: DecisionChoice["mode"];
	action: TypedDecisionAction;
}

interface DurableReplacement {
	decisionId: string;
	operationDigest: string;
	actions: readonly DurableActionBinding[];
}

interface DurableDecisionBase {
	decisionId: string;
	operationDigest: string;
	actions: readonly DurableActionBinding[];
}

interface DurableExecutionDecision extends DurableDecisionBase {
	actor: DurableDecisionActor;
	action: TypedDecisionAction;
	executionId: string;
	generation: number;
}

type DurableDecision =
	| (DurableDecisionBase & { state: "prepared" })
	| (DurableExecutionDecision & { state: "approved" })
	| (DurableExecutionDecision & {
			state: "leased";
			manifest?: ExecutionManifestBinding;
	  })
	| (DurableDecisionBase & {
			state: "cancelled";
			actor: DurableDecisionActor;
			action: TypedDecisionAction;
	  })
	| (DurableDecisionBase & {
			state: "superseded";
			replacement: DurableReplacement;
	  })
	| (DurableExecutionDecision & {
			state: "cancellation-tombstone";
			replacement: DurableReplacement;
			cancelledBy: DurableDecisionActor;
			cancellation: TypedDecisionAction;
			manifest?: ExecutionManifestBinding;
	  })
	| (DurableExecutionDecision & {
			state: "revoked";
			replacement: DurableReplacement;
			manifest?: ExecutionManifestBinding;
	  })
	| (DurableExecutionDecision & {
			state: "terminal";
			terminalState: string;
			manifest?: ExecutionManifestBinding;
	  });

type DurableExecutionBoundDecision = Extract<
	DurableDecision,
	{ executionId: string }
>;
type DurableCancelledDecision = Extract<
	DurableDecision,
	{ state: "cancelled" }
>;
type DurableSupersededDecision = Extract<
	DurableDecision,
	{ state: "superseded" }
>;
type DurableActiveDecision = Extract<
	DurableDecision,
	{ state: "approved" | "leased" }
>;
type DurableApprovedDecision = Extract<
	DurableDecision,
	{ state: "approved" }
>;
type DurableLeasedDecision = Extract<DurableDecision, { state: "leased" }>;
type DurableExecutingDecision = DurableLeasedDecision;
type DurableReplacementDecision = Extract<
	DurableDecision,
	{ replacement: DurableReplacement }
>;

interface DurableDecisionCandidate extends DurableDecisionBase {
	state: DecisionState;
	replacement?: DurableReplacement;
	actor?: DurableDecisionActor;
	action?: TypedDecisionAction;
	executionId?: string;
	generation?: number;
	manifest?: ExecutionManifestBinding;
	terminalState?: string;
	cancelledBy?: DurableDecisionActor;
	cancellation?: TypedDecisionAction;
}

interface DurableDecisionEnvelope {
	schema: "interactive-decision";
	schemaVersion: 1;
	scope: DecisionScope;
	generation: number;
	current: DurableDecision;
	history: readonly {
		decisionId: string;
		state: "cancelled" | "superseded" | "revoked";
	}[];
	firstApprover?: DurableDecisionActor;
	authorityHistory?: readonly DurableDecisionActor[];
	digest: string;
}

interface StoredEnvelope {
	revision: string;
	value: DurableDecisionEnvelope;
	content: string;
}

const semanticIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const semanticId = (value: unknown): value is string =>
	typeof value === "string" && semanticIdPattern.test(value);
const bindingText = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value.trim() === value;

function canonicalJson(value: unknown, seen = new Set<object>()): string {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw decisionError(
				"PI_WORKFLOW_DECISION_REQUEST_INVALID",
				"Decision canonical values must contain only finite numbers.",
			);
		return JSON.stringify(value);
	}
	if (typeof value !== "object")
		throw decisionError(
			"PI_WORKFLOW_DECISION_REQUEST_INVALID",
			"Decision canonical values contain an unsupported value.",
		);
	if (seen.has(value))
		throw decisionError(
			"PI_WORKFLOW_DECISION_REQUEST_INVALID",
			"Decision canonical values must not contain cycles.",
		);
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			if (Object.keys(value).length !== value.length)
				throw decisionError(
					"PI_WORKFLOW_DECISION_REQUEST_INVALID",
					"Decision canonical arrays must not be sparse or extended.",
				);
			return `[${value.map((entry) => canonicalJson(entry, seen)).join(",")}]`;
		}
		if (Object.getPrototypeOf(value) !== Object.prototype)
			throw decisionError(
				"PI_WORKFLOW_DECISION_REQUEST_INVALID",
				"Decision canonical values must use plain objects.",
			);
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(
				([key, entry]) =>
					`${JSON.stringify(key)}:${canonicalJson(entry, seen)}`,
			)
			.join(",")}}`;
	} finally {
		seen.delete(value);
	}
}

const sha256 = (value: string): string =>
	createHash("sha256").update(value).digest("hex");
const digestValue = (value: unknown): string => sha256(canonicalJson(value));
const clone = <T>(value: T): T => structuredClone(value);
const exact = (left: unknown, right: unknown): boolean =>
	canonicalJson(left) === canonicalJson(right);

function decisionError(code: DecisionErrorCode, message: string): Error {
	return Object.assign(new Error(message), { code });
}

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error))
		return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

function isDecisionCasConflict(error: unknown): boolean {
	return errorCode(error) === "PI_WORKFLOW_DECISION_CAS_CONFLICT";
}

function blocker(
	code: DecisionBlocker["code"],
	message: string,
): { kind: "blocked"; blocker: DecisionBlocker } {
	return { kind: "blocked", blocker: { code, message } };
}

function validateRequest(request: DecisionRequest): void {
	if (
		!request ||
		!bindingText(request.scope?.project) ||
		!bindingText(request.scope?.workflow) ||
		!bindingText(request.scope?.subject) ||
		!semanticId(request.operation?.kind) ||
		!semanticId(request.operation?.phase) ||
		!Array.isArray(request.operation.artifacts) ||
		!Array.isArray(request.operation.targets) ||
		!Array.isArray(request.operation.evidence) ||
		!request.presentation ||
		!bindingText(request.presentation.locale) ||
		!bindingText(request.presentation.summary) ||
		!Array.isArray(request.presentation.details) ||
		!Array.isArray(request.presentation.consequences) ||
		!Array.isArray(request.presentation.risks) ||
		!Array.isArray(request.presentation.choices)
	)
		throw decisionError(
			"PI_WORKFLOW_DECISION_REQUEST_INVALID",
			"Decision request is invalid.",
		);
	const choices = request.presentation.choices;
	if (
		choices.length < 2 ||
		choices.filter((choice) => choice?.mode === "cancel").length !== 1 ||
		!choices.some((choice) => choice?.mode === "execute")
	) {
		throw decisionError(
			"PI_WORKFLOW_DECISION_CANCEL_REQUIRED",
			"A closed decision requires one cancel choice and at least one executable choice.",
		);
	}
	const choiceIds = new Set<string>();
	const actionIds = new Set<string>();
	for (const choice of choices) {
		if (
			!semanticId(choice?.id) ||
			!semanticId(choice?.action?.id) ||
			!bindingText(choice.label) ||
			!bindingText(choice.description) ||
			!["execute", "cancel"].includes(choice.mode) ||
			choiceIds.has(choice.id) ||
			actionIds.has(choice.action.id)
		) {
			throw decisionError(
				"PI_WORKFLOW_DECISION_REQUEST_INVALID",
				"Decision choices require unique semantic choice and action IDs.",
			);
		}
		choiceIds.add(choice.id);
		actionIds.add(choice.action.id);
	}
	if (
		choices.find((choice) => choice.mode === "cancel")?.action.id !==
		"decision.cancel"
	) {
		throw decisionError(
			"PI_WORKFLOW_DECISION_CANCEL_REQUIRED",
			"The cancel choice must bind the stable decision.cancel action.",
		);
	}
	canonicalJson({
		scope: request.scope,
		operation: request.operation,
		actions: choices.map(({ id, mode, action }) => ({ id, mode, action })),
	});
}

function operationProjection(request: DecisionRequest) {
	return {
		schema: "interactive-operation" as const,
		schemaVersion: 1 as const,
		scope: request.scope,
		operation: request.operation,
		actions: request.presentation.choices.map(({ id, mode, action }) => ({
			id,
			mode,
			action,
		})),
	};
}

function scopeKey(scope: DecisionScope): string {
	if (
		!bindingText(scope?.project) ||
		!bindingText(scope?.workflow) ||
		!bindingText(scope?.subject)
	)
		throw decisionError(
			"PI_WORKFLOW_DECISION_REQUEST_INVALID",
			"Decision scope is invalid.",
		);
	return digestValue({
		schema: "interactive-decision-scope",
		schemaVersion: 1,
		scope,
	});
}

function unsignedEnvelope(
	value: DurableDecisionEnvelope,
): Omit<DurableDecisionEnvelope, "digest">;
function unsignedEnvelope(
	value: Omit<DurableDecisionEnvelope, "digest">,
): Omit<DurableDecisionEnvelope, "digest">;
function unsignedEnvelope(
	value: DurableDecisionEnvelope | Omit<DurableDecisionEnvelope, "digest">,
): Omit<DurableDecisionEnvelope, "digest"> {
	const { digest: _digest, ...unsigned } = value as DurableDecisionEnvelope;
	return unsigned;
}

function serialize(value: Omit<DurableDecisionEnvelope, "digest">): string {
	return `${canonicalJson({ ...value, digest: digestValue(value) })}\n`;
}

function durableActor(value: unknown): value is DurableDecisionActor {
	return (
		!!value &&
		typeof value === "object" &&
		exactKeys(value, ["actorId", "authorityRevision"]) &&
		bindingText((value as AuthenticatedDecisionActor).actorId) &&
		bindingText((value as AuthenticatedDecisionActor).authorityRevision)
	);
}

function validActor(value: unknown): value is AuthenticatedDecisionActor {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const actor = value as AuthenticatedDecisionActor;
	return (
		exactKeys(actor, ["actorId", "authorityRevision", "active", "guest"]) &&
		bindingText(actor.actorId) &&
		bindingText(actor.authorityRevision) &&
		actor.active === true &&
		actor.guest === false
	);
}

function actorIdentity(actor: AuthenticatedDecisionActor): DurableDecisionActor {
	return {
		actorId: actor.actorId,
		authorityRevision: actor.authorityRevision,
	};
}

function appendAuthority(
	history: readonly DurableDecisionActor[] | undefined,
	actor: DurableDecisionActor | undefined,
): readonly DurableDecisionActor[] {
	const current = history ?? [];
	if (!actor || (current.length > 0 && exact(current.at(-1), actor)))
		return current;
	return [...current, clone(actor)];
}

function activeDecision(
	decision: DurableDecision,
): decision is DurableActiveDecision {
	return decision.state === "approved" || decision.state === "leased";
}

function replacementDecision(
	decision: DurableDecision,
): decision is DurableReplacementDecision {
	return ["superseded", "cancellation-tombstone", "revoked"].includes(
		decision.state,
	);
}

function executionFields(decision: DurableExecutionBoundDecision) {
	return {
		decisionId: decision.decisionId,
		operationDigest: decision.operationDigest,
		actions: decision.actions,
		actor: decision.actor,
		action: decision.action,
		executionId: decision.executionId,
		generation: decision.generation,
		...(decision.state !== "approved" && decision.manifest
			? { manifest: decision.manifest }
			: {}),
	};
}

function parseEnvelope(
	content: string,
	expectedScope: DecisionScope,
): DurableDecisionEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw decisionError(
			"PI_WORKFLOW_DECISION_STATE_CORRUPT",
			"Decision state is not valid JSON.",
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw decisionError(
			"PI_WORKFLOW_DECISION_STATE_CORRUPT",
			"Decision state is invalid.",
		);
	const value = parsed as Omit<DurableDecisionEnvelope, "current"> & {
		current?: DurableDecisionCandidate;
	};
	if (value.schemaVersion !== 1)
		throw decisionError(
			"PI_WORKFLOW_DECISION_SCHEMA_UNSUPPORTED",
			"Decision state schema is unsupported.",
		);
	const current = value.current;
	const actions = Array.isArray(current?.actions) ? current.actions : [];
	const actionIds = new Set(actions.map((entry) => entry.action?.id));
	const choiceIds = new Set(actions.map((entry) => entry.id));
	const baseCurrentKeys = ["decisionId", "operationDigest", "actions", "state"];
	const stateCurrentKeys: Partial<Record<DecisionState, readonly string[]>> = {
		prepared: baseCurrentKeys,
		superseded: [...baseCurrentKeys, "replacement"],
		revoked: [
			...baseCurrentKeys,
			"replacement",
			"actor",
			"action",
			"executionId",
			"generation",
			...(current?.manifest === undefined ? [] : ["manifest"]),
		],
		"cancellation-tombstone": [
			...baseCurrentKeys,
			"replacement",
			"actor",
			"action",
			"executionId",
			"generation",
			"cancelledBy",
			"cancellation",
			...(current?.manifest === undefined ? [] : ["manifest"]),
		],
		cancelled: [...baseCurrentKeys, "actor", "action"],
		approved: [
			...baseCurrentKeys,
			"actor",
			"action",
			"executionId",
			"generation",
		],
		leased: [
			...baseCurrentKeys,
			"actor",
			"action",
			"executionId",
			"generation",
			...(current?.manifest === undefined ? [] : ["manifest"]),
		],
		terminal: [
			...baseCurrentKeys,
			"actor",
			"action",
			"executionId",
			"generation",
			"terminalState",
			...(current?.manifest === undefined ? [] : ["manifest"]),
		],
	};
	const currentKeys = current && stateCurrentKeys[current.state];
	if (
		!exactKeys(value as unknown as Record<string, unknown>, [
			"schema",
			"schemaVersion",
			"scope",
			"generation",
			"current",
			"history",
			...(value.firstApprover === undefined ? [] : ["firstApprover"]),
			...(value.authorityHistory === undefined ? [] : ["authorityHistory"]),
			"digest",
		]) ||
		!exactKeys(value.scope as unknown as Record<string, unknown>, [
			"project",
			"workflow",
			"subject",
		]) ||
		!currentKeys ||
		!exactKeys(current as unknown as Record<string, unknown>, currentKeys) ||
		value.schema !== "interactive-decision" ||
		!exact(value.scope, expectedScope) ||
		!Number.isSafeInteger(value.generation) ||
		value.generation < 0 ||
		!Array.isArray(value.history) ||
		!value.history.every(
			(entry) =>
				exactKeys(entry as unknown as Record<string, unknown>, [
					"decisionId",
					"state",
				]) &&
				!!parseDecisionId(entry?.decisionId) &&
				["cancelled", "superseded", "revoked"].includes(entry.state),
		) ||
		(value.firstApprover !== undefined && !durableActor(value.firstApprover)) ||
		(value.authorityHistory !== undefined &&
			(!Array.isArray(value.authorityHistory) ||
				!value.authorityHistory.every(durableActor))) ||
		!current ||
		!parseDecisionId(current.decisionId) ||
		!/^[a-f0-9]{64}$/.test(current.operationDigest) ||
		![
			"prepared",
			"approved",
			"leased",
			"cancelled",
			"superseded",
			"cancellation-tombstone",
			"revoked",
			"terminal",
		].includes(current.state) ||
		!Array.isArray(current.actions) ||
		!current.actions.every(
			(entry) =>
				exactKeys(entry as unknown as Record<string, unknown>, [
					"id",
					"mode",
					"action",
				]) &&
				exactKeys(entry.action as unknown as Record<string, unknown>, [
					"id",
					"input",
				]) &&
				semanticId(entry.id) &&
				["execute", "cancel"].includes(entry.mode) &&
				semanticId(entry.action?.id),
		) ||
		actionIds.size !== current.actions.length ||
		choiceIds.size !== current.actions.length ||
		current.actions.filter((entry) => entry.mode === "cancel").length !== 1 ||
		current.actions.find((entry) => entry.mode === "cancel")?.action.id !==
			"decision.cancel" ||
		!current.actions.some((entry) => entry.mode === "execute") ||
		(current.actor !== undefined &&
			(!exactKeys(current.actor as unknown as Record<string, unknown>, [
				"actorId",
				"authorityRevision",
			]) ||
					!durableActor(current.actor))) ||
		(current.action !== undefined &&
			!exactKeys(current.action as unknown as Record<string, unknown>, [
				"id",
				"input",
			])) ||
		(current.state === "cancelled" &&
			(!durableActor(current.actor) ||
				!current.action ||
				!exact(
					current.action,
					current.actions.find((entry) => entry.mode === "cancel")?.action,
				))) ||
		(["superseded", "cancellation-tombstone", "revoked"].includes(
			current.state,
		) &&
			(!exactKeys(current.replacement, [
				"decisionId",
				"operationDigest",
				"actions",
			]) ||
				!parseDecisionId(current.replacement?.decisionId) ||
				current.replacement?.decisionId !==
					`${scopeKey(value.scope)}:${current.replacement?.operationDigest}` ||
				!/^[a-f0-9]{64}$/.test(current.replacement?.operationDigest ?? "") ||
				!Array.isArray(current.replacement?.actions) ||
				current.replacement.actions.filter((entry) => entry.mode === "cancel")
					.length !== 1 ||
				current.replacement.actions.find((entry) => entry.mode === "cancel")
					?.action.id !== "decision.cancel" ||
				!current.replacement.actions.some(
					(entry) => entry.mode === "execute",
				) ||
				new Set(current.replacement.actions.map((entry) => entry.id)).size !==
					current.replacement.actions.length ||
				new Set(current.replacement.actions.map((entry) => entry.action?.id))
					.size !== current.replacement.actions.length ||
				!current.replacement.actions.every(
					(entry) =>
						exactKeys(entry, ["id", "mode", "action"]) &&
						exactKeys(entry.action, ["id", "input"]) &&
						semanticId(entry.id) &&
						semanticId(entry.action?.id) &&
						["execute", "cancel"].includes(entry.mode),
				))) ||
		(current.state === "cancellation-tombstone" &&
			(!durableActor(current.cancelledBy) ||
				!current.cancellation ||
				!exact(
					current.cancellation,
					current.actions.find((entry) => entry.mode === "cancel")?.action,
				))) ||
		([
			"approved",
			"leased",
			"cancellation-tombstone",
			"revoked",
			"terminal",
		].includes(current.state) &&
			(!durableActor(current.actor) ||
				!current.action ||
				!current.actions.some((entry) => exact(entry.action, current.action)) ||
				!bindingText(current.executionId) ||
				!Number.isSafeInteger(current.generation) ||
				current.generation !== value.generation)) ||
		(current.state === "terminal" && !bindingText(current.terminalState)) ||
		(current.manifest !== undefined &&
			![
				"leased",
				"cancellation-tombstone",
				"revoked",
				"terminal",
			].includes(current.state))
	)
		throw decisionError(
			"PI_WORKFLOW_DECISION_STATE_CORRUPT",
			"Decision state shape is invalid.",
		);
	if (
		current.decisionId !== `${scopeKey(value.scope)}:${current.operationDigest}`
	)
		throw decisionError(
			"PI_WORKFLOW_DECISION_STATE_CORRUPT",
			"Decision operation binding is invalid.",
		);
	if (
		current.manifest !== undefined &&
		!validManifest(current.manifest, candidateExecutionBinding(current))
	)
		throw decisionError(
			"PI_WORKFLOW_DECISION_STATE_CORRUPT",
			"Decision manifest binding is invalid.",
		);
	const durable = parsed as DurableDecisionEnvelope;
	const { digest, ...unsigned } = durable;
	if (
		!/^[a-f0-9]{64}$/.test(digest) ||
		digest !== digestValue(unsigned) ||
		content !== serialize(unsignedEnvelope(unsigned))
	)
		throw decisionError(
			"PI_WORKFLOW_DECISION_STATE_CORRUPT",
			"Decision state digest or canonical bytes are invalid.",
		);
	return durable;
}

function parseDecisionId(
	decisionId: unknown,
): { key: string; operationDigest: string } | undefined {
	if (typeof decisionId !== "string") return undefined;
	const match = /^([a-f0-9]{64}):([a-f0-9]{64})$/.exec(decisionId);
	return match ? { key: match[1], operationDigest: match[2] } : undefined;
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return (
		actual.length === wanted.length &&
		actual.every((key, index) => key === wanted[index])
	);
}

function validManifest(
	value: unknown,
	expected: ExecutionBinding,
): value is ExecutionManifestBinding {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const manifest = value as ExecutionManifestBinding;
	return (
		exactKeys(manifest as unknown as Record<string, unknown>, [
			"ref",
			"decisionId",
			"operationDigest",
			"executionId",
			"generation",
		]) &&
		bindingText(manifest.ref) &&
		exact(
			{
				decisionId: manifest.decisionId,
				operationDigest: manifest.operationDigest,
				executionId: manifest.executionId,
				generation: manifest.generation,
			},
			{
				decisionId: expected.decisionId,
				operationDigest: expected.operationDigest,
				executionId: expected.executionId,
				generation: expected.generation,
			},
		)
	);
}

function supersededReceipt(
	current: DurableSupersededDecision,
): Extract<DecisionReceipt, { state: "superseded" }> {
	return { state: "superseded", decisionId: current.decisionId };
}

function cancelledReceipt(
	current: DurableCancelledDecision,
): Extract<DecisionReceipt, { state: "cancelled" }> {
	return {
		state: "cancelled",
		decisionId: current.decisionId,
		actionId: "decision.cancel",
		actorId: current.actor.actorId,
	};
}

function leasedReceipt(
	current: DurableExecutingDecision,
): Extract<DecisionReceipt, { state: "leased" }> {
	const currentLease = lease(current);
	return {
		state: "leased",
		decisionId: currentLease.decisionId,
		actionId: currentLease.action.id,
		actorId: currentLease.actorId,
		executionId: currentLease.executionId,
		generation: currentLease.generation,
	};
}

function lease(current: DurableExecutingDecision): ExecutionLease {
	return {
		decisionId: current.decisionId,
		operationDigest: current.operationDigest,
		actorId: current.actor.actorId,
		authorityRevision: current.actor.authorityRevision,
		action: clone(current.action),
		executionId: current.executionId,
		generation: current.generation,
	};
}

function candidateExecutionBinding(
	current: DurableDecisionCandidate,
): ExecutionBinding {
	if (!current.executionId || current.generation === undefined)
		throw decisionError(
			"PI_WORKFLOW_DECISION_STATE_CORRUPT",
			"Decision execution binding is incomplete.",
		);
	return {
		decisionId: current.decisionId,
		operationDigest: current.operationDigest,
		executionId: current.executionId,
		generation: current.generation,
	};
}

export function createInMemoryDecisionStore(): DecisionStore {
	const values = new Map<string, DecisionStoreRead>();
	const revisions = new Map<string, string>();
	let revision = 0;
	return {
		async read(key) {
			return clone(values.get(key));
		},
		async readRevision(key, expectedRevision) {
			return revisions.get(`${key}:${expectedRevision}`);
		},
		async compareAndSwap(key, expectedRevision, content) {
			const current = values.get(key);
			if ((current?.revision ?? null) !== expectedRevision)
				throw decisionError(
					"PI_WORKFLOW_DECISION_CAS_CONFLICT",
					"Decision store compare-and-swap conflict.",
				);
			revision += 1;
			const saved = { revision: `decision-${revision}`, content };
			values.set(key, saved);
			revisions.set(`${key}:${saved.revision}`, content);
			return { revision: saved.revision };
		},
	};
}

export function createEngramDecisionStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string | (() => string);
	readonly topicPrefix?: string;
}): DecisionStore {
	if (options.store.capabilities?.atomicCompareAndSwap !== true)
		throw decisionError(
			"PI_WORKFLOW_DECISION_STORE_UNAVAILABLE",
			"Decision store requires atomic compare-and-swap.",
		);
	const project = () =>
		typeof options.project === "function" ? options.project() : options.project;
	const topic = (key: string) =>
		`${options.topicPrefix ?? "workflow/interactive-decisions"}/${key}`;
	return {
		async read(key) {
			return options.store.readCurrent(project(), topic(key));
		},
		async readRevision(key, revision) {
			return options.store.readRevision(project(), topic(key), revision);
		},
		async compareAndSwap(key, expectedRevision, content) {
			try {
				return await options.store.write(
					project(),
					topic(key),
					content,
					expectedRevision ?? undefined,
				);
			} catch (error) {
				if (errorCode(error) === "PI_WORKFLOW_ENGRAM_CONDITIONAL_WRITE_FAILED")
					throw decisionError(
						"PI_WORKFLOW_DECISION_CAS_CONFLICT",
						"Decision store compare-and-swap conflict.",
					);
				throw error;
			}
		},
	};
}

export function createInteractiveDecisions(options: {
	readonly store: DecisionStore;
	readonly claimSource?: DecisionClaimSource;
	readonly manifestLookup?: ManifestLookup;
	readonly createExecutionId?: () => string;
}) {
	const createExecutionId = options.createExecutionId ?? randomUUID;

	async function load(
		scope: DecisionScope,
	): Promise<StoredEnvelope | undefined> {
		return loadByKey(scopeKey(scope));
	}

	async function loadByKey(key: string): Promise<StoredEnvelope | undefined> {
		const stored = await options.store.read(key);
		if (!stored) return undefined;
		let parsed: unknown;
		try {
			parsed = JSON.parse(stored.content);
		} catch {
			throw decisionError(
				"PI_WORKFLOW_DECISION_STATE_CORRUPT",
				"Decision state is not valid JSON.",
			);
		}
		const candidateScope = (parsed as { scope?: DecisionScope } | null)?.scope;
		if (!candidateScope || scopeKey(candidateScope) !== key)
			throw decisionError(
				"PI_WORKFLOW_DECISION_STATE_CORRUPT",
				"Decision state scope binding is invalid.",
			);
		return {
			revision: stored.revision,
			value: parseEnvelope(stored.content, candidateScope),
			content: stored.content,
		};
	}

	async function save(
		scope: DecisionScope,
		expectedRevision: string | null,
		value: Omit<DurableDecisionEnvelope, "digest">,
	): Promise<StoredEnvelope> {
		const key = scopeKey(scope);
		const content = serialize(value);
		let written: { readonly revision: string };
		try {
			written = await options.store.compareAndSwap(
				key,
				expectedRevision,
				content,
			);
		} catch (error) {
			if (isDecisionCasConflict(error))
				throw decisionError(
					"PI_WORKFLOW_DECISION_CAS_CONFLICT",
					"Decision store compare-and-swap conflict.",
				);
			throw error;
		}
		const readBack = await options.store.readRevision(key, written.revision);
		if (readBack !== content)
			throw decisionError(
				"PI_WORKFLOW_DECISION_READBACK_MISMATCH",
				"Decision store durable read-back mismatch.",
			);
		return {
			revision: written.revision,
			value: parseEnvelope(readBack, scope),
			content: readBack,
		};
	}

	async function prepareRequest(
		request: DecisionRequest,
		mode: PreparationMode,
	): Promise<DecisionPresentation> {
		validateRequest(request);
		const projection = operationProjection(request);
		const operationDigest = digestValue(
			mode.kind === "reapprove"
				? {
						...projection,
						reapproval: {
							priorDecisionId: mode.priorDecisionId,
							generation: mode.generation,
						},
					}
				: projection,
		);
		const decisionId = `${scopeKey(request.scope)}:${operationDigest}`;
		const replacement: DurableReplacement = {
			decisionId,
			operationDigest,
			actions: clone(projection.actions),
		};
		let current = await load(request.scope);
		if (!current || current.value.current.decisionId !== decisionId) {
			if (current && activeDecision(current.value.current) && mode.kind === "normal")
				throw decisionError(
					"PI_WORKFLOW_DECISION_REPLAY",
					"An authorized decision must be recovered or cancelled before replacement.",
				);
			if (current && activeDecision(current.value.current) && mode.kind !== "normal") {
				const revokedDecisionId = current.value.current.decisionId;
				if (mode.kind === "replace") {
					const cancellation = current.value.current.actions.find(
						(entry) => entry.mode === "cancel",
					)?.action;
					if (!cancellation)
						throw decisionError(
							"PI_WORKFLOW_DECISION_STATE_CORRUPT",
							"Active decision has no cancellation action.",
						);
					try {
						current = await save(request.scope, current.revision, {
							...unsignedEnvelope(current.value),
							current: {
								...executionFields(current.value.current),
								state: "cancellation-tombstone",
								replacement,
								cancelledBy: mode.actor,
								cancellation: clone(cancellation),
							},
							history: [
								...current.value.history,
								{ decisionId: revokedDecisionId, state: "cancelled" },
							],
							authorityHistory: appendAuthority(
								current.value.authorityHistory,
								current.value.current.actor,
							),
						});
					} catch (error) {
						if (!isDecisionCasConflict(error)) throw error;
						current = await load(request.scope);
						if (
							current?.value.current.state !== "cancellation-tombstone" ||
							current.value.current.decisionId !== revokedDecisionId ||
							!exact(current.value.current.replacement, replacement) ||
							!exact(current.value.current.cancelledBy, mode.actor)
						)
							throw error;
					}
				}
				const revocationSource = current.value.current;
				if (
					!activeDecision(revocationSource) &&
					revocationSource.state !== "cancellation-tombstone"
				)
					throw decisionError(
						"PI_WORKFLOW_DECISION_CAS_CONFLICT",
						"Decision changed before approval revocation.",
					);
				try {
					current = await save(request.scope, current.revision, {
						...unsignedEnvelope(current.value),
						current: {
							...executionFields(revocationSource),
							state: "revoked",
							replacement,
						},
						history: [
							...current.value.history,
							{ decisionId: revokedDecisionId, state: "revoked" },
						],
						authorityHistory: appendAuthority(
							current.value.authorityHistory,
							revocationSource.actor,
						),
					});
				} catch (error) {
					if (!isDecisionCasConflict(error)) throw error;
					current = await load(request.scope);
					if (
						current?.value.current.state !== "revoked" ||
						current.value.current.decisionId !== revokedDecisionId ||
						!exact(current.value.current.replacement, replacement)
					)
						throw error;
				}
			}
			if (
				current?.value.current.state === "prepared" &&
				current.value.current.decisionId !== decisionId
			) {
				const supersededDecisionId = current.value.current.decisionId;
				try {
					current = await save(request.scope, current.revision, {
						...unsignedEnvelope(current.value),
						current: {
							...current.value.current,
							state: "superseded",
							replacement,
						},
					});
				} catch (error) {
					if (!isDecisionCasConflict(error)) throw error;
					current = await load(request.scope);
					if (
						current?.value.current.state !== "superseded" ||
						current.value.current.decisionId !== supersededDecisionId ||
						!exact(current.value.current.replacement, replacement)
					)
						throw error;
				}
			}
			if (
				current &&
				replacementDecision(current.value.current) &&
				!exact(current.value.current.replacement, replacement)
			)
				throw decisionError(
					"PI_WORKFLOW_DECISION_CAS_CONFLICT",
					"A different replacement already owns this decision scope.",
				);
			if (
				current?.value.current.decisionId === decisionId &&
				current.value.current.state === "prepared"
			) {
				// Adopt the exact concurrent winner.
			} else {
				let history = current?.value.history ?? [];
				if (
					current?.value.current.state === "cancelled" ||
					current?.value.current.state === "superseded"
				)
					history = [
						...history,
						{
							decisionId: current.value.current.decisionId,
							state: current.value.current.state,
						},
					];
				else if (current && current.value.current.state !== "revoked")
					throw decisionError(
						"PI_WORKFLOW_DECISION_REPLAY",
						"Concurrent decision state cannot be replaced.",
					);
				try {
					current = await save(request.scope, current?.revision ?? null, {
						schema: "interactive-decision",
						schemaVersion: 1,
							scope: clone(request.scope),
							generation: current?.value.generation ?? 0,
							current: { ...replacement, state: "prepared" },
							history,
							...(current?.value.firstApprover
								? { firstApprover: clone(current.value.firstApprover) }
								: {}),
							...(current?.value.authorityHistory
								? {
										authorityHistory: clone(
											current.value.authorityHistory,
										),
									}
								: {}),
						});
				} catch (error) {
					if (!isDecisionCasConflict(error)) throw error;
					const winner = await load(request.scope);
					if (
						!winner ||
						winner.value.current.decisionId !== decisionId ||
						winner.value.current.state !== "prepared"
					)
						throw error;
					current = winner;
				}
			}
		} else if (current.value.current.state !== "prepared") {
			throw decisionError(
				"PI_WORKFLOW_DECISION_REPLAY",
				"A terminal or authorized decision cannot be prepared again.",
			);
		}
		return clone({
			decisionId,
			summary: request.presentation.summary,
			details: request.presentation.details,
			consequences: request.presentation.consequences,
			risks: request.presentation.risks,
			choices: request.presentation.choices.map(
				({ id, mode, action, label, description }) => ({
					id,
					mode,
					actionId: action.id,
					label,
					description,
				}),
			),
		});
	}

	async function prepare(request: DecisionRequest): Promise<DecisionPresentation> {
		return prepareRequest(request, { kind: "normal" });
	}

	async function authorize(
		decisionId: string,
		action: TypedDecisionAction,
		actor: AuthenticatedDecisionActor,
	): Promise<AuthorizationOutcome> {
		const parsedDecisionId = parseDecisionId(decisionId);
		if (!parsedDecisionId || !semanticId(action?.id))
			return blocker(
				"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
				"Decision authorization input is invalid.",
			);
		if (!validActor(actor))
			return blocker(
				"PI_WORKFLOW_DECISION_ACTOR_MISMATCH",
				"Decision authorization actor is invalid.",
			);
		const frozenActor = clone(actor);
		const authority = actorIdentity(frozenActor);
		const key = parsedDecisionId.key;
		let stored = await loadByKey(key);
		if (!stored || stored.value.current.decisionId !== decisionId)
			return blocker(
				"PI_WORKFLOW_DECISION_NOT_FOUND",
				"Decision was not found in the requested scope.",
			);
		const scope = stored.value.scope;
		const current = stored.value.current;
		if (current.state !== "prepared")
			return blocker(
				"PI_WORKFLOW_DECISION_REPLAY",
				"Decision has already been consumed.",
			);
		const selected = current.actions.find((entry) =>
			exact(entry.action, action),
		);
		if (!selected)
			return blocker(
				"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
				"Typed action does not match the prepared decision.",
			);
		if (
			!options.claimSource ||
			!(await options.claimSource.consume(decisionId, action, frozenActor))
		)
			return blocker(
				"PI_WORKFLOW_DECISION_CLAIM_MISSING",
				"No fresh presentation claim authorizes this action.",
			);
		if (selected.mode === "cancel") {
			const cancelled: DurableCancelledDecision = {
				decisionId: current.decisionId,
				operationDigest: current.operationDigest,
				actions: current.actions,
				state: "cancelled",
				actor: authority,
				action: clone(action),
			};
			try {
				await save(scope, stored.revision, {
					...unsignedEnvelope(stored.value),
					current: cancelled,
					history: stored.value.history,
				});
				return {
					kind: "cancelled",
					decisionId,
					receipt: cancelledReceipt(cancelled),
				};
			} catch (error) {
				if (isDecisionCasConflict(error))
					return blocker(
						"PI_WORKFLOW_DECISION_CAS_CONFLICT",
						"Another action consumed this decision.",
					);
				throw error;
			}
		}
		const generation = stored.value.generation + 1;
		const approvedDecision: DurableApprovedDecision = {
			...current,
			state: "approved",
			actor: authority,
			action: clone(action),
			executionId: createExecutionId(),
			generation,
		};
		const approved: Omit<DurableDecisionEnvelope, "digest"> = {
			...unsignedEnvelope(stored.value),
			generation,
			firstApprover: stored.value.firstApprover ?? authority,
			authorityHistory: stored.value.authorityHistory ?? [],
			current: approvedDecision,
		};
		try {
			stored = await save(scope, stored.revision, approved);
			if (stored.value.current.state !== "approved")
				throw decisionError(
					"PI_WORKFLOW_DECISION_STATE_CORRUPT",
					"Approved decision state was not persisted.",
				);
			const leasedDecision: DurableLeasedDecision = {
				...stored.value.current,
				state: "leased",
			};
			stored = await save(scope, stored.revision, {
				...unsignedEnvelope(stored.value),
				current: leasedDecision,
			});
			if (stored.value.current.state !== "leased")
				throw decisionError(
					"PI_WORKFLOW_DECISION_STATE_CORRUPT",
					"Leased decision state was not persisted.",
				);
			return {
				kind: "authorized",
				lease: lease(stored.value.current),
				receipt: leasedReceipt(stored.value.current),
			};
		} catch (error) {
			if (isDecisionCasConflict(error))
				return blocker(
					"PI_WORKFLOW_DECISION_CAS_CONFLICT",
					"Another action consumed this decision.",
				);
			throw error;
		}
	}

	async function recover(
		scope: DecisionScope,
		actor: AuthenticatedDecisionActor,
		directive?: RecoveryDirective,
	): Promise<RecoveryOutcome> {
		if (!validActor(actor))
			return blocker(
				"PI_WORKFLOW_DECISION_ACTOR_MISMATCH",
				"Recovery actor is invalid.",
			);
		const frozenActor = actorIdentity(actor);
		let stored = await load(scope);
		if (!stored) return { kind: "none" };
		let current = stored.value.current;
		if (current.state === "prepared")
			return { kind: "prepared", decisionId: current.decisionId };
		if (current.state === "cancelled")
			return {
				kind: "cancelled",
				decisionId: current.decisionId,
				receipt: cancelledReceipt(current),
			};
		if (current.state === "superseded")
			return {
				kind: "superseded",
				decisionId: current.decisionId,
				receipt: supersededReceipt(current),
			};
		if (
			current.state === "cancellation-tombstone" ||
			current.state === "revoked"
		)
			return {
				kind: "superseded",
				decisionId: current.decisionId,
				receipt: {
					state: "superseded",
					decisionId: current.decisionId,
				},
			};
		if (current.state === "terminal")
			return {
				kind: "terminal",
				decisionId: current.decisionId,
				state: current.terminalState,
				currentApprover: clone(current.actor),
			};
		if (!activeDecision(current))
			throw decisionError(
				"PI_WORKFLOW_DECISION_STATE_CORRUPT",
				"Recoverable decision state is invalid.",
			);
		if (directive?.kind === "cancel") {
			const cancelAction = current.actions.find(
				(entry) => entry.mode === "cancel",
			)?.action;
			if (!cancelAction)
				throw decisionError(
					"PI_WORKFLOW_DECISION_STATE_CORRUPT",
					"Active decision has no cancellation action.",
				);
			try {
				stored = await save(scope, stored.revision, {
					...unsignedEnvelope(stored.value),
					authorityHistory: appendAuthority(
						stored.value.authorityHistory,
						current.actor,
					),
					current: {
						decisionId: current.decisionId,
						operationDigest: current.operationDigest,
						actions: current.actions,
						state: "cancelled",
						actor: frozenActor,
						action: clone(cancelAction),
					},
				});
			} catch (error) {
				if (isDecisionCasConflict(error))
					return blocker(
						"PI_WORKFLOW_DECISION_CAS_CONFLICT",
						"Decision cancellation lost its fencing race.",
					);
				throw error;
			}
			if (stored.value.current.state !== "cancelled")
				throw decisionError(
					"PI_WORKFLOW_DECISION_STATE_CORRUPT",
					"Cancelled decision state was not persisted.",
				);
			return {
				kind: "cancelled",
				decisionId: current.decisionId,
				receipt: cancelledReceipt(stored.value.current),
			};
		}
		if (directive?.kind === "terminal") {
			if (!bindingText(directive.state))
				return blocker(
					"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
					"Terminal recovery state is invalid.",
				);
			try {
				stored = await save(scope, stored.revision, {
					...unsignedEnvelope(stored.value),
					current: {
						...current,
						state: "terminal",
						terminalState: directive.state,
					},
				});
			} catch (error) {
				if (isDecisionCasConflict(error))
					return blocker(
						"PI_WORKFLOW_DECISION_CAS_CONFLICT",
						"Terminal recovery lost its fencing race.",
					);
				throw error;
			}
			return {
				kind: "terminal",
				decisionId: current.decisionId,
				state: directive.state,
				currentApprover: clone(current.actor),
			};
		}
		const sameAuthority =
			current.actor.actorId === frozenActor.actorId &&
			current.actor.authorityRevision === frozenActor.authorityRevision;
		if (directive?.kind === "resume" && !sameAuthority) {
			if (!directive.request || !exact(directive.request.scope, scope))
				return blocker(
					"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
					"Changed-authority resume requires an exact-scope reapproval request.",
				);
			let presentation: DecisionPresentation;
			try {
				presentation = await prepareRequest(directive.request, {
					kind: "reapprove",
					actor: frozenActor,
					priorDecisionId: current.decisionId,
					generation: stored.value.generation + 1,
				});
			} catch (error) {
				if (isDecisionCasConflict(error)) return recover(scope, actor);
				throw error;
			}
			return {
				kind: "reapproval",
				previousDecisionId: current.decisionId,
				presentation,
			};
		}
		if (directive?.kind === "replace" || directive?.kind === "drift") {
			if (!exact(directive.request?.scope, scope))
				return blocker(
					"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
					"Recovery replacement must remain in the recovered decision scope.",
				);
			if (
				directive.kind === "drift" &&
				(!bindingText(directive.diff?.summary) ||
					!Array.isArray(directive.diff.details) ||
					!directive.diff.details.every(bindingText))
			)
				return blocker(
					"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
					"Workflow drift requires a human-readable diff.",
				);
			let presentation: DecisionPresentation;
			try {
				presentation = await prepareRequest(directive.request, {
					kind: "replace",
					actor: frozenActor,
				});
			} catch (error) {
				if (isDecisionCasConflict(error)) return recover(scope, actor);
				throw error;
			}
			return directive.kind === "drift"
				? {
						kind: "drift",
						presentation,
						diff: clone(directive.diff),
					}
				: { kind: "prepared", decisionId: presentation.decisionId };
		}
		if (!sameAuthority)
			return {
				kind: "active",
				decisionId: current.decisionId,
				executionId: current.executionId,
				generation: current.generation,
				currentApprover: clone(current.actor),
				reapprovalRequired: true,
				actions: ["resume", "replace", "cancel"],
			};
		if (current.state === "approved") {
			const leasedDecision: DurableLeasedDecision = {
				...current,
				state: "leased",
			};
			try {
				stored = await save(scope, stored.revision, {
					...unsignedEnvelope(stored.value),
					current: leasedDecision,
				});
			} catch (error) {
				if (isDecisionCasConflict(error))
					return blocker(
						"PI_WORKFLOW_DECISION_CAS_CONFLICT",
						"Decision recovery lost its fencing race.",
					);
				throw error;
			}
			current = stored.value.current;
		}
		if (current.state !== "leased")
			throw decisionError(
				"PI_WORKFLOW_DECISION_STATE_CORRUPT",
				"Resumable decision did not hold a lease.",
			);
		const currentLease = lease(current);
		const manifests = options.manifestLookup
			? await options.manifestLookup.find(currentLease)
			: [];
		const latest = await load(scope);
		if (!latest || latest.revision !== stored.revision)
			return blocker(
				"PI_WORKFLOW_DECISION_CAS_CONFLICT",
				"Decision changed while recovery evidence was inspected.",
			);
		if (current.manifest) {
			if (!validManifest(current.manifest, currentLease))
				return blocker(
					"PI_WORKFLOW_DECISION_MANIFEST_CONFLICT",
					"Bound execution manifest is malformed or mismatched.",
				);
			if (
				manifests.length &&
				(manifests.length !== 1 ||
					!exact(manifests[0], current.manifest))
			)
				return blocker(
					"PI_WORKFLOW_DECISION_MANIFEST_CONFLICT",
					"Bound execution manifest conflicts with durable evidence.",
				);
			return {
				kind: "authorized",
				lease: currentLease,
				receipt: leasedReceipt(current),
				manifest: clone(current.manifest),
			};
		}
		if (
			manifests.length > 1 ||
			manifests.some((manifest) => !validManifest(manifest, currentLease))
		)
			return blocker(
				"PI_WORKFLOW_DECISION_MANIFEST_CONFLICT",
				"Execution manifest evidence is ambiguous or mismatched.",
			);
		if (manifests.length === 1) {
			const manifestedDecision: DurableLeasedDecision = {
				...current,
				manifest: clone(manifests[0]),
			};
			try {
				stored = await save(scope, stored.revision, {
					...unsignedEnvelope(stored.value),
					current: manifestedDecision,
				});
			} catch (error) {
				if (isDecisionCasConflict(error))
					return blocker(
						"PI_WORKFLOW_DECISION_CAS_CONFLICT",
						"Manifest binding lost its fencing race.",
					);
				throw error;
			}
			return {
				kind: "authorized",
				lease: currentLease,
				receipt: leasedReceipt(manifestedDecision),
				manifest: clone(manifests[0]),
			};
		}
		return {
			kind: "authorized",
			lease: currentLease,
			receipt: leasedReceipt(current),
		};
	}

	return { prepare, authorize, recover };
}
