import { createHash, randomUUID } from "node:crypto";

import type {
	ExtensionAPI,
	InputEvent,
} from "@earendil-works/pi-coding-agent";
import type {
	AuthenticatedDecisionActor,
	AuthorizationOutcome,
	DecisionClaimBinding,
	DecisionClaimSource,
	DecisionPresentation,
	DecisionRequest,
	DecisionScope,
	EffectAuthorizationOutcome,
	ExecutionLease,
	ExecutionManifestBinding,
	RecoveryDirective,
	RecoveryOutcome,
	TypedDecisionAction,
} from "./interactive-decisions.ts";

const QUESTION_TOOL = "ask_user_question";
const PANEL_OPTION_LIMIT = 4;
const RESERVED_LABELS = new Set(["Other", "Type something.", "Next"]);

interface PiDecisionContext {
	readonly sessionId: string;
	readonly runId: string;
	readonly sequence: number;
	readonly actor: AuthenticatedDecisionActor;
	readonly claimBinding: DecisionClaimBinding;
}

interface PiDecisionCapability {
	readonly hasUI: boolean;
	readonly activeTools: readonly string[];
}

type PiDecisionPrompt =
	| {
			readonly kind: "panel";
			readonly input: {
				readonly questions: readonly [
					{
						readonly question: string;
						readonly header: "Decision";
						readonly options: readonly {
							readonly label: string;
							readonly description: string;
						}[];
						readonly multiSelect: false;
					},
				];
			};
	  }
	| { readonly kind: "fallback"; readonly text: string };

export interface PiDecisionAdapter {
	readonly claimSource: DecisionClaimSource;
	present(
		input: PiDecisionContext & {
			readonly presentation: DecisionPresentation;
			readonly capability: PiDecisionCapability;
		},
	): PiDecisionPrompt;
	handleToolCall(input: PiDecisionToolCall): boolean;
	handleToolResult(input: PiDecisionToolResult): PiDecisionResult;
	handleFallbackResponse(input: PiDecisionFallbackResponse): PiDecisionResult;
	handlePiToolCall(
		input: Omit<PiDecisionToolCall, "runId" | "sequence">,
	): boolean;
	handlePiToolResult(
		input: Omit<PiDecisionToolResult, "runId" | "sequence">,
	): PiDecisionResult;
	handlePiFallbackResponse(
		input: Pick<PiDecisionFallbackResponse, "sessionId" | "text">,
	): PiDecisionResult;
	resetSession(sessionId: string): void;
	hasActiveDecision(sessionId: string, workflow: string): boolean;
}

interface InteractiveDecisionService {
	prepare(request: DecisionRequest): Promise<DecisionPresentation>;
	authorize(
		decisionId: string,
		action: TypedDecisionAction,
		actor: AuthenticatedDecisionActor,
	): Promise<AuthorizationOutcome>;
	claimBinding(decisionId: string): Promise<DecisionClaimBinding | undefined>;
	bindExecutionManifest(
		lease: ExecutionLease,
		manifest: ExecutionManifestBinding,
	): Promise<EffectAuthorizationOutcome>;
	authorizeEffect(lease: ExecutionLease): Promise<EffectAuthorizationOutcome>;
	recover(
		scope: DecisionScope,
		actor: AuthenticatedDecisionActor,
		directive?: RecoveryDirective,
	): Promise<RecoveryOutcome>;
}

export interface PiInteractiveDecisions {
	prepare(
		request: DecisionRequest,
		actor: AuthenticatedDecisionActor,
	): Promise<DecisionPresentation>;
	authorize(
		decisionId: string,
		action: TypedDecisionAction,
		actor: AuthenticatedDecisionActor,
	): Promise<AuthorizationOutcome>;
	bindExecutionManifest(
		lease: ExecutionLease,
		manifest: ExecutionManifestBinding,
	): Promise<EffectAuthorizationOutcome>;
	authorizeEffect(lease: ExecutionLease): Promise<EffectAuthorizationOutcome>;
	hasActiveDecision(workflow: string): boolean;
	recover(
		scope: DecisionScope,
		actor: AuthenticatedDecisionActor,
		directive?: RecoveryDirective,
	): Promise<RecoveryOutcome>;
}

interface PiDecisionCorrelation {
	readonly sessionId: string;
	readonly runId: string;
	readonly sequence: number;
}

interface PiDecisionToolCall extends PiDecisionCorrelation {
	readonly toolName: string;
	readonly toolCallId: string;
	readonly input: unknown;
}

interface PiDecisionToolResult extends PiDecisionCorrelation {
	readonly toolName: string;
	readonly toolCallId: string;
	readonly details: unknown;
	readonly isError: boolean;
}

interface PiDecisionFallbackResponse extends PiDecisionCorrelation {
	readonly text: string;
}

type PiDecisionResult = "claimed" | "feedback" | "cancelled" | "ignored";

interface Reservation {
	readonly correlation: PiDecisionCorrelation;
	readonly actor: AuthenticatedDecisionActor;
	readonly claimBinding: DecisionClaimBinding;
	readonly presentation: DecisionPresentation;
	readonly presentationDigest: string;
	readonly prompt: PiDecisionPrompt;
	readonly expiresAt: number;
	toolCallId?: string;
}

interface Claim {
	readonly sessionId: string;
	readonly binding: DecisionClaimBinding;
	readonly actionId: string;
	readonly actor: AuthenticatedDecisionActor;
	readonly expiresAt: number;
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value: unknown, seen = new Set<object>()): string {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Non-canonical number.");
		return JSON.stringify(value);
	}
	if (typeof value !== "object") throw new Error("Unsupported canonical value.");
	if (seen.has(value)) throw new Error("Cyclic canonical value.");
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			if (Object.keys(value).length !== value.length)
				throw new Error("Non-canonical array.");
			return `[${value.map((entry) => canonical(entry, seen)).join(",")}]`;
		}
		if (Object.getPrototypeOf(value) !== Object.prototype)
			throw new Error("Non-canonical object.");
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(
				([key, entry]) =>
					`${JSON.stringify(key)}:${canonical(entry, seen)}`,
			)
			.join(",")}}`;
	} finally {
		seen.delete(value);
	}
}

function exact(left: unknown, right: unknown): boolean {
	try {
		return canonical(left) === canonical(right);
	} catch {
		return false;
	}
}

function digest(value: unknown): string {
	return createHash("sha256").update(canonical(value)).digest("hex");
}

function exactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	return exact(actual, [...keys].sort());
}

function correlationKey(input: PiDecisionCorrelation): string {
	return `${input.sessionId}\u0000${input.runId}`;
}

function validCorrelation(input: PiDecisionCorrelation): boolean {
	return (
		typeof input.sessionId === "string" &&
		input.sessionId.length > 0 &&
		input.sessionId === input.sessionId.trim() &&
		typeof input.runId === "string" &&
		input.runId.length > 0 &&
		input.runId === input.runId.trim() &&
		Number.isSafeInteger(input.sequence) &&
		input.sequence > 0
	);
}

function questionText(presentation: DecisionPresentation): string {
	const sections = [
		presentation.summary,
		presentation.details.length
			? `Details:\n${presentation.details.map((item) => `- ${item}`).join("\n")}`
			: undefined,
		presentation.consequences.length
			? `Consequences:\n${presentation.consequences.map((item) => `- ${item}`).join("\n")}`
			: undefined,
		presentation.risks.length
			? `Risks:\n${presentation.risks.map((item) => `- ${item}`).join("\n")}`
			: undefined,
	].filter((section): section is string => section !== undefined);
	return `${sections.join("\n\n")}\n\nChoose one option?`;
}

function supportsPanel(
	presentation: DecisionPresentation,
	capability: PiDecisionCapability,
): boolean {
	const labels = presentation.choices.map((choice) => choice.label);
	return (
		capability.hasUI &&
		capability.activeTools.includes(QUESTION_TOOL) &&
		presentation.choices.length <= PANEL_OPTION_LIMIT &&
		new Set(labels).size === labels.length &&
		presentation.choices.every(
			(choice) =>
				choice.label.length <= 60 && !RESERVED_LABELS.has(choice.label),
		)
	);
}

export function createPiDecisionAdapter(
	options: { readonly timeoutMs?: number; readonly now?: () => number } = {},
): PiDecisionAdapter {
	const timeoutMs = options.timeoutMs ?? 5 * 60_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
		throw new Error("Pi decision timeout must be a positive integer.");
	const now = options.now ?? Date.now;
	const reservations = new Map<string, Reservation>();
	const reservationOwners = new Map<string, string>();
	const latestSequences = new Map<string, number>();
	const claims = new Map<string, Claim>();
	let activeSession: string | undefined;

	function reservation(input: PiDecisionCorrelation): Reservation | undefined {
		if (!validCorrelation(input)) return undefined;
		const reserved = reservations.get(correlationKey(input));
		if (!reserved || reserved.correlation.sequence !== input.sequence)
			return undefined;
		if (digest(reserved.presentation) !== reserved.presentationDigest) {
			release(reserved);
			return undefined;
		}
		if (reserved.expiresAt <= now()) {
			reservations.delete(correlationKey(input));
			reservationOwners.delete(reserved.presentation.decisionId);
			return undefined;
		}
		return reserved;
	}

	function release(reserved: Reservation): void {
		const key = correlationKey(reserved.correlation);
		if (reservations.get(key) === reserved) reservations.delete(key);
		if (reservationOwners.get(reserved.presentation.decisionId) === key)
			reservationOwners.delete(reserved.presentation.decisionId);
	}

	function activeReservations(session: string): Reservation[] {
		return [...reservations.values()].filter(
			(reserved) =>
				reserved.correlation.sessionId === session &&
				reservation(reserved.correlation) === reserved,
		);
	}

	function claim(reserved: Reservation, choiceIndex: number): PiDecisionResult {
		const choice = reserved.presentation.choices[choiceIndex];
		if (!choice) return "ignored";
		claims.set(reserved.presentation.decisionId, {
			sessionId: reserved.correlation.sessionId,
			binding: structuredClone(reserved.claimBinding),
			actionId: choice.actionId,
			actor: reserved.actor,
			expiresAt: reserved.expiresAt,
		});
		return "claimed";
	}

	const claimSource: DecisionClaimSource = {
		async consume(decisionId, action, actor, binding) {
			const pending = claims.get(decisionId);
			if (
				!pending ||
				pending.expiresAt <= now() ||
				pending.sessionId !== activeSession
			) {
				claims.delete(decisionId);
				return false;
			}
			if (
				!exact(pending.actor, actor) ||
				pending.actionId !== action.id ||
				!exact(pending.binding, {
					scope: binding.scope,
					generation: binding.generation,
				}) ||
				(binding.sessionId !== undefined &&
					pending.sessionId !== binding.sessionId)
			)
				return false;
			claims.delete(decisionId);
			return true;
		},
	};
	return {
		claimSource,
		present(input) {
			if (!validCorrelation(input))
				throw new Error("Pi decision correlation is invalid.");
			const key = correlationKey(input);
			activeSession = input.sessionId;
			const latest = latestSequences.get(key) ?? 0;
			if (input.sequence <= latest)
				throw new Error("Pi decision sequence must advance monotonically.");
			const question = questionText(input.presentation);
			const options = input.presentation.choices.map(
				({ label, description }) => ({
					label,
					description,
				}),
			);
			const prompt: PiDecisionPrompt = supportsPanel(
				input.presentation,
				input.capability,
			)
				? {
						kind: "panel",
						input: {
							questions: [
								{
									question,
									header: "Decision",
									options,
									multiSelect: false,
								},
							],
						},
					}
				: {
						kind: "fallback",
						text: `${question}\n\n${options
							.map(
								(option, index) =>
									`${index + 1}. ${option.label} - ${option.description}`,
							)
							.join("\n")}`,
					};
			const priorKey = reservationOwners.get(input.presentation.decisionId);
			if (priorKey) reservations.delete(priorKey);
			const prior = reservations.get(key);
			if (prior) reservationOwners.delete(prior.presentation.decisionId);
			claims.delete(input.presentation.decisionId);
			const privatePresentation = structuredClone(input.presentation);
			const privatePrompt = structuredClone(prompt);
			const reserved: Reservation = {
				correlation: {
					sessionId: input.sessionId,
					runId: input.runId,
					sequence: input.sequence,
				},
				actor: structuredClone(input.actor),
				claimBinding: structuredClone(input.claimBinding),
				presentation: privatePresentation,
				presentationDigest: digest(privatePresentation),
				prompt: privatePrompt,
				expiresAt: now() + timeoutMs,
			};
			reservations.set(key, reserved);
			reservationOwners.set(input.presentation.decisionId, key);
			latestSequences.set(key, input.sequence);
			return prompt;
		},
		handleToolCall(input) {
			const reserved = reservation(input);
			if (
				reserved?.prompt.kind !== "panel" ||
				input.toolName !== QUESTION_TOOL ||
				typeof input.toolCallId !== "string" ||
				!input.toolCallId ||
				reserved.toolCallId !== undefined ||
				!exact(input.input, reserved.prompt.input)
			)
				return false;
			reserved.toolCallId = input.toolCallId;
			return true;
		},
		handleToolResult(input) {
			const reserved = reservation(input);
			if (
				reserved?.prompt.kind !== "panel" ||
				input.toolName !== QUESTION_TOOL ||
				reserved.toolCallId !== input.toolCallId
			)
				return "ignored";
			release(reserved);
			if (input.isError || !record(input.details)) return "ignored";
			const details = input.details;
			if (
				details.cancelled === true &&
				Array.isArray(details.answers) &&
				details.answers.length === 0 &&
				exactKeys(details, ["answers", "cancelled"])
			)
				return "cancelled";
			if (
				details.cancelled !== false ||
				!Array.isArray(details.answers) ||
				details.answers.length !== 1 ||
				!exactKeys(details, ["answers", "cancelled"])
			)
				return "ignored";
			const answer = details.answers[0];
			if (
				!record(answer) ||
				!exactKeys(answer, ["answer", "kind", "question", "questionIndex"]) ||
				answer.questionIndex !== 0 ||
				answer.question !== reserved.prompt.input.questions[0].question ||
				typeof answer.answer !== "string"
			)
				return "ignored";
			if (answer.kind === "custom") return "feedback";
			if (answer.kind !== "option") return "ignored";
			const choiceIndex = reserved.presentation.choices.findIndex(
				(choice) => choice.label === answer.answer,
			);
			return claim(reserved, choiceIndex);
		},
		handleFallbackResponse(input) {
			const reserved = reservation(input);
			if (reserved?.prompt.kind !== "fallback") return "ignored";
			release(reserved);
			const match = input.text.match(/^\s*([1-9][0-9]*)\s*$/);
			if (!match?.[1]) return input.text.trim() ? "feedback" : "ignored";
			return claim(reserved, Number(match[1]) - 1);
		},
		handlePiToolCall(input) {
			const matches = activeReservations(input.sessionId).filter(
				(reserved) =>
					reserved.prompt.kind === "panel" &&
					reserved.toolCallId === undefined &&
					input.toolName === QUESTION_TOOL &&
					exact(input.input, reserved.prompt.input),
			);
			if (matches.length !== 1) return false;
			const [reserved] = matches;
			if (!reserved) return false;
			return this.handleToolCall({
				...input,
				runId: reserved.correlation.runId,
				sequence: reserved.correlation.sequence,
			});
		},
		handlePiToolResult(input) {
			const matches = activeReservations(input.sessionId).filter(
				(reserved) =>
					reserved.toolCallId === input.toolCallId,
			);
			if (matches.length !== 1) return "ignored";
			const [reserved] = matches;
			if (!reserved) return "ignored";
			return this.handleToolResult({
				...input,
				runId: reserved.correlation.runId,
				sequence: reserved.correlation.sequence,
			});
		},
		handlePiFallbackResponse(input) {
			const matches = activeReservations(input.sessionId).filter(
				(reserved) =>
					reserved.prompt.kind === "fallback",
			);
			if (matches.length !== 1) return "ignored";
			const [reserved] = matches;
			if (!reserved) return "ignored";
			return this.handleFallbackResponse({
				...input,
				runId: reserved.correlation.runId,
				sequence: reserved.correlation.sequence,
			});
		},
		resetSession(sessionId) {
			for (const reserved of [...reservations.values()]) {
				if (reserved.correlation.sessionId === sessionId) release(reserved);
			}
			for (const [decisionId, pending] of claims) {
				if (pending.sessionId === sessionId) claims.delete(decisionId);
			}
			for (const key of latestSequences.keys()) {
				if (key.startsWith(`${sessionId}\u0000`)) latestSequences.delete(key);
			}
			if (activeSession === sessionId) activeSession = undefined;
		},
		hasActiveDecision(sessionId, workflow) {
			return activeReservations(sessionId).some(
				(reserved) => reserved.claimBinding.scope.workflow === workflow,
			);
		},
	};
}

function sessionId(ctx: unknown): string | undefined {
	if (!record(ctx) || !record(ctx.sessionManager)) return undefined;
	const getSessionId = ctx.sessionManager.getSessionId;
	if (typeof getSessionId !== "function") return undefined;
	try {
		const value = getSessionId.call(ctx.sessionManager);
		return typeof value === "string" && value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

function runtimeCapability(
	pi: ExtensionAPI,
	ctx: unknown,
): PiDecisionCapability {
	let activeTools: readonly string[] = [];
	try {
		const tools = pi.getActiveTools();
		if (Array.isArray(tools) && tools.every((tool) => typeof tool === "string"))
			activeTools = tools;
	} catch {
		// A host that cannot report tools cannot safely use the panel.
	}
	return {
		hasUI: record(ctx) && ctx.hasUI === true,
		activeTools,
	};
}

export function registerPiDecisionAdapter(
	pi: ExtensionAPI,
	adapter: PiDecisionAdapter,
	decisions: InteractiveDecisionService,
	getContext: () => unknown = () => undefined,
	createRunId: () => string = randomUUID,
	onClaimed?: () => Promise<void> | void,
): PiInteractiveDecisions {
	const pending = new Map<
		string,
		{
			readonly presentation: DecisionPresentation;
			readonly actor: AuthenticatedDecisionActor;
			readonly claimBinding: DecisionClaimBinding;
		}
	>();
	const sequences = new Map<string, number>();
	let activeSession: string | undefined;
	function clearSession(session: string): void {
		pending.delete(session);
		sequences.delete(session);
		adapter.resetSession(session);
	}
	function queuePresentation(
		presentation: DecisionPresentation,
		actor: AuthenticatedDecisionActor,
		claimBinding: DecisionClaimBinding,
	): void {
		const session = sessionId(getContext());
		if (!session) return;
		activeSession ??= session;
		pending.set(session, { presentation, actor, claimBinding });
	}
	pi.on("session_start", (_event, ctx) => {
		const session = sessionId(ctx);
		if (activeSession && activeSession !== session) clearSession(activeSession);
		activeSession = session;
	});
	pi.on("before_agent_start", (_event, ctx) => {
		const session = sessionId(ctx);
		if (!session) return undefined;
		const prepared = pending.get(session);
		if (!prepared) return undefined;
		pending.delete(session);
		const sequence = (sequences.get(session) ?? 0) + 1;
		sequences.set(session, sequence);
		const prompt = adapter.present({
			sessionId: session,
			runId: createRunId(),
			sequence,
			actor: prepared.actor,
			claimBinding: prepared.claimBinding,
			presentation: prepared.presentation,
			capability: runtimeCapability(pi, ctx),
		});
		return {
			systemPrompt:
				prompt.kind === "panel"
					? `Call ask_user_question exactly once with ${JSON.stringify(prompt.input)}. Wait for its result before continuing. Do not expose tool or workflow metadata.`
					: `Present this decision verbatim and wait for one new user response. Do not infer approval.\n\n${prompt.text}`,
		};
	});
	pi.on("tool_call", (event, ctx) => {
		const session = sessionId(ctx);
		if (!session || event.toolName !== QUESTION_TOOL) return undefined;
		adapter.handlePiToolCall({
			sessionId: session,
			toolName: event.toolName,
			toolCallId: event.toolCallId,
			input: event.input,
		});
		return undefined;
	});
	pi.on("tool_result", async (event, ctx) => {
		const session = sessionId(ctx);
		if (!session || event.toolName !== QUESTION_TOOL) return undefined;
		const outcome = adapter.handlePiToolResult({
			sessionId: session,
			toolName: event.toolName,
			toolCallId: event.toolCallId,
			details: event.details,
			isError: event.isError,
		});
		if (outcome === "claimed") await onClaimed?.();
		return undefined;
	});
	pi.on("input", async (event: InputEvent, ctx) => {
		const session = sessionId(ctx);
		if (
			!session ||
			event.source !== "interactive" ||
			event.streamingBehavior !== undefined
		)
			return undefined;
		const outcome = adapter.handlePiFallbackResponse({
			sessionId: session,
			text: event.text,
		});
		if (outcome === "claimed") await onClaimed?.();
		return undefined;
	});
	pi.on("session_shutdown", (_event, ctx) => {
		const session = sessionId(ctx) ?? activeSession;
		if (session) clearSession(session);
		activeSession = undefined;
	});
	return {
		async prepare(request, actor) {
			const presentation = await decisions.prepare(request);
			const binding = await decisions.claimBinding(presentation.decisionId);
			if (binding) queuePresentation(presentation, actor, binding);
			return presentation;
		},
		authorize: (decisionId, action, actor) =>
			decisions.authorize(decisionId, action, actor),
		bindExecutionManifest: (lease, manifest) =>
			decisions.bindExecutionManifest(lease, manifest),
		authorizeEffect: (lease) => decisions.authorizeEffect(lease),
		async recover(scope, actor, directive) {
			const outcome = await decisions.recover(scope, actor, directive);
			if (outcome.kind === "reapproval" || outcome.kind === "drift") {
				const binding = await decisions.claimBinding(
					outcome.presentation.decisionId,
				);
				if (binding) queuePresentation(outcome.presentation, actor, binding);
			}
			return outcome;
		},
		hasActiveDecision(workflow) {
			const session = sessionId(getContext());
			return !!session && adapter.hasActiveDecision(session, workflow);
		},
	};
}
