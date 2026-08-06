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
	| { readonly kind: "blocked"; readonly blocker: DecisionBlocker };

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

interface ClaimSource {
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
	| "superseded";

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

interface DurableDecision {
	decisionId: string;
	operationDigest: string;
	actions: readonly DurableActionBinding[];
	state: DecisionState;
	replacement?: DurableReplacement;
	actor?: AuthenticatedDecisionActor;
	action?: TypedDecisionAction;
	executionId?: string;
	generation?: number;
	manifest?: ExecutionManifestBinding;
}

interface DurableDecisionEnvelope {
	schema: "interactive-decision";
	schemaVersion: 1;
	scope: DecisionScope;
	generation: number;
	current: DurableDecision;
	history: readonly { decisionId: string; state: "cancelled" | "superseded" }[];
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

function validActor(value: unknown): value is AuthenticatedDecisionActor {
	return (
		!!value &&
		typeof value === "object" &&
		bindingText((value as AuthenticatedDecisionActor).actorId) &&
		bindingText((value as AuthenticatedDecisionActor).authorityRevision)
	);
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
	const value = parsed as DurableDecisionEnvelope;
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
				["cancelled", "superseded"].includes(entry.state),
		) ||
		!current ||
		!parseDecisionId(current.decisionId) ||
		!/^[a-f0-9]{64}$/.test(current.operationDigest) ||
		!["prepared", "approved", "leased", "cancelled", "superseded"].includes(
			current.state,
		) ||
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
				!validActor(current.actor))) ||
		(current.action !== undefined &&
			!exactKeys(current.action as unknown as Record<string, unknown>, [
				"id",
				"input",
			])) ||
		(current.state === "cancelled" &&
			(!validActor(current.actor) ||
				!current.action ||
				!exact(
					current.action,
					current.actions.find((entry) => entry.mode === "cancel")?.action,
				))) ||
		(current.state === "superseded" &&
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
		(["approved", "leased"].includes(current.state) &&
			(!validActor(current.actor) ||
				!current.action ||
				!current.actions.some((entry) => exact(entry.action, current.action)) ||
				!bindingText(current.executionId) ||
				!Number.isSafeInteger(current.generation) ||
				current.generation !== value.generation)) ||
		(current.manifest !== undefined && current.state !== "leased")
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
		!validManifest(current.manifest, lease(current))
	)
		throw decisionError(
			"PI_WORKFLOW_DECISION_STATE_CORRUPT",
			"Decision manifest binding is invalid.",
		);
	const { digest, ...unsigned } = value;
	if (
		!/^[a-f0-9]{64}$/.test(digest) ||
		digest !== digestValue(unsigned) ||
		content !== serialize(unsignedEnvelope(unsigned))
	)
		throw decisionError(
			"PI_WORKFLOW_DECISION_STATE_CORRUPT",
			"Decision state digest or canonical bytes are invalid.",
		);
	return value;
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
	expected: ExecutionLease,
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

function receipt(current: DurableDecision): DecisionReceipt {
	if (current.state === "superseded") {
		return { state: "superseded", decisionId: current.decisionId };
	}
	if (current.state === "cancelled") {
		if (!current.actor || current.action?.id !== "decision.cancel")
			throw decisionError(
				"PI_WORKFLOW_DECISION_STATE_CORRUPT",
				"Cancelled decision receipt is incomplete.",
			);
		return {
			state: "cancelled",
			decisionId: current.decisionId,
			actionId: "decision.cancel",
			actorId: current.actor.actorId,
		};
	}
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

function lease(current: DurableDecision): ExecutionLease {
	if (
		!current.actor ||
		!current.action ||
		!current.executionId ||
		current.generation === undefined
	)
		throw decisionError(
			"PI_WORKFLOW_DECISION_STATE_CORRUPT",
			"Authorized decision lease is incomplete.",
		);
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
	readonly claimSource?: ClaimSource;
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

	async function prepare(
		request: DecisionRequest,
	): Promise<DecisionPresentation> {
		validateRequest(request);
		const projection = operationProjection(request);
		const operationDigest = digestValue(projection);
		const decisionId = `${scopeKey(request.scope)}:${operationDigest}`;
		const replacement: DurableReplacement = {
			decisionId,
			operationDigest,
			actions: clone(projection.actions),
		};
		let current = await load(request.scope);
		if (!current || current.value.current.decisionId !== decisionId) {
			if (
				current &&
				["approved", "leased"].includes(current.value.current.state)
			)
				throw decisionError(
					"PI_WORKFLOW_DECISION_REPLAY",
					"An authorized decision must be recovered or cancelled before replacement.",
				);
			if (current?.value.current.state === "prepared") {
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
				}
			}
			if (
				current?.value.current.state === "superseded" &&
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
				const previousState =
					current?.value.current.state === "cancelled"
						? ("cancelled" as const)
						: ("superseded" as const);
				const history = current
					? [
							...current.value.history,
							{
								decisionId: current.value.current.decisionId,
								state: previousState,
							},
						]
					: [];
				try {
					current = await save(request.scope, current?.revision ?? null, {
						schema: "interactive-decision",
						schemaVersion: 1,
						scope: clone(request.scope),
						generation: current?.value.generation ?? 0,
						current: { ...replacement, state: "prepared" },
						history,
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

	async function authorize(
		decisionId: string,
		action: TypedDecisionAction,
		actor: AuthenticatedDecisionActor,
	): Promise<AuthorizationOutcome> {
		const parsedDecisionId = parseDecisionId(decisionId);
		if (!parsedDecisionId || !semanticId(action?.id) || !validActor(actor))
			return blocker(
				"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
				"Decision authorization input is invalid.",
			);
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
			!(await options.claimSource.consume(decisionId, action, actor))
		)
			return blocker(
				"PI_WORKFLOW_DECISION_CLAIM_MISSING",
				"No fresh presentation claim authorizes this action.",
			);
		if (selected.mode === "cancel") {
			try {
				await save(scope, stored.revision, {
					...unsignedEnvelope(stored.value),
					current: {
						...current,
						state: "cancelled",
						actor: clone(actor),
						action: clone(action),
					},
					history: stored.value.history,
				});
				const cancelled = {
					...current,
					state: "cancelled" as const,
					actor: clone(actor),
					action: clone(action),
				};
				return {
					kind: "cancelled",
					decisionId,
					receipt: receipt(cancelled) as Extract<
						DecisionReceipt,
						{ state: "cancelled" }
					>,
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
		const approved: Omit<DurableDecisionEnvelope, "digest"> = {
			...unsignedEnvelope(stored.value),
			generation,
			current: {
				...current,
				state: "approved",
				actor: clone(actor),
				action: clone(action),
				executionId: createExecutionId(),
				generation,
			},
		};
		try {
			stored = await save(scope, stored.revision, approved);
			stored = await save(scope, stored.revision, {
				...unsignedEnvelope(stored.value),
				current: { ...stored.value.current, state: "leased" },
			});
			return {
				kind: "authorized",
				lease: lease(stored.value.current),
				receipt: receipt(stored.value.current) as Extract<
					DecisionReceipt,
					{ state: "leased" }
				>,
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
	): Promise<RecoveryOutcome> {
		if (!validActor(actor))
			return blocker(
				"PI_WORKFLOW_DECISION_ACTOR_MISMATCH",
				"Recovery actor is invalid.",
			);
		let stored = await load(scope);
		if (!stored) return { kind: "none" };
		const current = stored.value.current;
		if (current.state === "prepared")
			return { kind: "prepared", decisionId: current.decisionId };
		if (current.state === "cancelled")
			return {
				kind: "cancelled",
				decisionId: current.decisionId,
				receipt: receipt(current) as Extract<
					DecisionReceipt,
					{ state: "cancelled" }
				>,
			};
		if (current.state === "superseded")
			return {
				kind: "superseded",
				decisionId: current.decisionId,
				receipt: receipt(current) as Extract<
					DecisionReceipt,
					{ state: "superseded" }
				>,
			};
		if (
			!current.actor ||
			current.actor.actorId !== actor.actorId ||
			current.actor.authorityRevision !== actor.authorityRevision
		)
			return blocker(
				"PI_WORKFLOW_DECISION_ACTOR_MISMATCH",
				"Recovery actor does not match the approving authority.",
			);
		if (current.state === "approved") {
			try {
				stored = await save(scope, stored.revision, {
					...unsignedEnvelope(stored.value),
					current: { ...current, state: "leased" },
				});
			} catch (error) {
				if (isDecisionCasConflict(error))
					return blocker(
						"PI_WORKFLOW_DECISION_CAS_CONFLICT",
						"Decision recovery lost its fencing race.",
					);
				throw error;
			}
		}
		const currentLease = lease(stored.value.current);
		const manifests = options.manifestLookup
			? await options.manifestLookup.find(currentLease)
			: [];
		if (stored.value.current.manifest) {
			if (!validManifest(stored.value.current.manifest, currentLease))
				return blocker(
					"PI_WORKFLOW_DECISION_MANIFEST_CONFLICT",
					"Bound execution manifest is malformed or mismatched.",
				);
			if (
				manifests.length &&
				(manifests.length !== 1 ||
					!exact(manifests[0], stored.value.current.manifest))
			)
				return blocker(
					"PI_WORKFLOW_DECISION_MANIFEST_CONFLICT",
					"Bound execution manifest conflicts with durable evidence.",
				);
			return {
				kind: "authorized",
				lease: currentLease,
				receipt: receipt(stored.value.current) as Extract<
					DecisionReceipt,
					{ state: "leased" }
				>,
				manifest: clone(stored.value.current.manifest),
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
			try {
				stored = await save(scope, stored.revision, {
					...unsignedEnvelope(stored.value),
					current: { ...stored.value.current, manifest: clone(manifests[0]) },
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
				receipt: receipt(stored.value.current) as Extract<
					DecisionReceipt,
					{ state: "leased" }
				>,
				manifest: clone(manifests[0]),
			};
		}
		return {
			kind: "authorized",
			lease: currentLease,
			receipt: receipt(stored.value.current) as Extract<
				DecisionReceipt,
				{ state: "leased" }
			>,
		};
	}

	return { prepare, authorize, recover };
}
