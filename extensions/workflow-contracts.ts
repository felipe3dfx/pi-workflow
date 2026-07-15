import { createHash, randomBytes } from "node:crypto";

export type Route = "wayfinder" | "grilling";
type Clarity = "clear" | "unclear";
type Breadth = "narrow" | "broad";
type ArtifactSchema =
	| "research-evidence"
	| "design-exploration"
	| "delivery-ticket-graph"
	| "delivery-parent"
	| "product-spec"
	| "workflow-progress";
type ArtifactStrategy = "snapshot" | "merge-progress";
export type WorkflowBlockerCode =
	| "PI_WORKFLOW_ROUTE_CONFIRMATION_REQUIRED"
	| "PI_WORKFLOW_ROUTE_CONFIRMATION_MISMATCH"
	| "PI_WORKFLOW_ROUTE_CONFIRMATION_TOKEN_INVALID"
	| "PI_WORKFLOW_ROUTE_CONFIRMATION_EXPIRED"
	| "PI_WORKFLOW_DEFINITION_ID_MISMATCH"
	| "PI_WORKFLOW_SKILL_RESOLUTION_FAILED"
	| "PI_WORKFLOW_STANDARDS_RESOLUTION_FAILED"
	| "PI_WORKFLOW_AGENT_ASSET_NOT_READY"
	| "PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH"
	| "PI_WORKFLOW_EXACT_MODEL_UNAVAILABLE"
	| "PI_WORKFLOW_LAUNCH_PROVENANCE_MISMATCH"
	| "PI_WORKFLOW_RESEARCH_ARTIFACT_INVALID"
	| "PI_WORKFLOW_ARTIFACT_WRITE_FAILED"
	| "PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH"
	| "PI_WORKFLOW_ARTIFACT_REVISION_CONFLICT"
	| "PI_WORKFLOW_ENGRAM_CONDITIONAL_WRITE_UNSUPPORTED"
	| "PI_WORKFLOW_ARTIFACT_ALIAS_DENIED"
	| "PI_WORKFLOW_PROGRESS_BATCH_CONFLICT"
	| "PI_WORKFLOW_PROGRESS_SUPERSEDES_INVALID"
	| "PI_WORKFLOW_INTENT_UNSUPPORTED"
	| "PI_WORKFLOW_INTERVENTION_UNSUPPORTED"
	| "PI_WORKFLOW_INTERVENTION_INVALID"
	| "PI_WORKFLOW_DELEGATION_INTERRUPTED"
	| "PI_WORKFLOW_DELEGATION_CANCELLED"
	| "PI_WORKFLOW_RECOVERY_FAILED"
	| "PI_WORKFLOW_DISCOVERED_PATH_INVALID"
	| "PI_WORKFLOW_RETRY_EXHAUSTED"
	| "PI_WORKFLOW_SPEC_ARTIFACT_INVALID"
	| "PI_WORKFLOW_SPEC_APPROVAL_REQUIRED"
	| "PI_WORKFLOW_SPEC_APPROVAL_MISMATCH"
	| "PI_WORKFLOW_TICKET_ARTIFACT_INVALID";

export interface WorkflowBlocker {
	code: WorkflowBlockerCode;
	message: string;
}

export interface Assessment {
	clarity: Clarity;
	breadth: Breadth;
	reasons: readonly string[];
}

export interface ProjectRef {
	name: string;
	root: string;
}

export interface DigestedRef {
	kind: "skill" | "standard";
	name: string;
	path: string;
	digest: string;
}

export interface SkillRequirement {
	name: string;
}

export interface RouteRecommendation {
	definitionId: string;
	domainAnchor: string;
	domainAnchorDigest: string;
	assessment: Assessment;
	recommendedRoute: Route;
	digest: string;
	confirmationToken: string;
	issuedAt: number;
}

export interface ArtifactGrant {
	project: ProjectRef;
	/** The only writable topic in this capability grant. */
	topic: string;
	schema: ArtifactSchema;
	schemaVersion: 1;
	strategy: ArtifactStrategy;
	aliases: readonly {
		alias: string;
		ref: VerifiedArtifactRef;
	}[];
}

export interface StoredArtifactRead {
	revision: string;
	content: string;
}

export interface VerifiedArtifactRef {
	kind: "engram";
	project: string;
	topic: string;
	revision: string;
	schema: ArtifactSchema;
	schemaVersion: 1;
	digest: string;
}

export function uniqueVerifiedArtifactRefs(
	artifacts: readonly VerifiedArtifactRef[],
): readonly VerifiedArtifactRef[] {
	const unique = new Map<string, VerifiedArtifactRef>();
	for (const artifact of artifacts) unique.set(canonicalJson(artifact), artifact);
	return [...unique.values()];
}

export interface ProgressBatch {
	batchKey: string;
	payload: unknown;
	digest?: string;
	supersedes?: string;
}

export interface StoredProgressBatch {
	batchKey: string;
	payload: unknown;
	digest: string;
	supersedes?: string;
}

export interface WorkflowProgressEnvelope {
	schema: "workflow-progress";
	schemaVersion: 1;
	payload: { batches: readonly StoredProgressBatch[] };
	digest: string;
}

interface ResearchArtifactBinding {
	assignmentId: string;
	definitionId: string;
	recommendationDigest: string;
	route: Route;
	question: string;
	domainAnchorDigest: string;
}

export interface ExactLaunchProvenance {
	agentName: "research" | "prototype" | "to-tickets";
	assetVersion: number;
	assetDigest: string;
	capabilityProfile: "research-reader" | "isolated-prototype" | "artifact-reader";
	provider: "openai-codex";
	model: "gpt-5.6-terra";
	effort: "medium";
	inheritContext: false;
	promptMode: "replace";
	skillRefs: readonly DigestedRef[];
	standardRefs: readonly DigestedRef[];
	allowedTools: readonly string[];
	deniedCapabilities: readonly string[];
	artifactTopic: string;
}

interface ResearchEvidenceItem {
	uri: string;
	title: string;
	retrievedAt: string;
	publishedAt?: string;
	excerpt?: string;
}

export interface ResearchFinding {
	claim: string;
	evidence: readonly ResearchEvidenceItem[];
}

export interface ResearchEvidenceV1 {
	assignmentId: string;
	definitionId: string;
	recommendationDigest: string;
	route: Route;
	question: string;
	domainAnchorDigest: string;
	findings: readonly ResearchFinding[];
	limitations: readonly string[];
	skillRefs: readonly DigestedRef[];
	standardRefs: readonly DigestedRef[];
	launchProvenance: ExactLaunchProvenance;
}

export interface ResearchEvidenceEnvelope {
	schema: "research-evidence";
	schemaVersion: 1;
	payload: ResearchEvidenceV1;
	digest: string;
}

export interface ProductSpecTarget {
	kind: "linear-parent-description";
	teamId: string;
	title: string;
}

export interface ProductSpecInput {
	definitionId: string;
	target: ProductSpecTarget;
	revision: string;
	problem: string;
	solution: string;
	userStories: readonly string[];
	decisions: readonly {
		id: string;
		status: "open" | "resolved";
		pertinent: boolean;
		text: string;
	}[];
	tests: readonly string[];
	outOfScope: readonly string[];
	supportArtifacts: readonly VerifiedArtifactRef[];
}

export interface ProductSpecEnvelope {
	schema: "product-spec";
	schemaVersion: 1;
	payload: {
		definitionId: string;
		target: ProductSpecTarget;
		revision: string;
		language: "es";
		body: string;
		decisions: readonly { id: string; text: string }[];
		supportArtifacts: readonly VerifiedArtifactRef[];
	};
	digest: string;
}

export interface AuthenticatedAuthority {
	actorId: string;
	role: "Owner" | "Developer";
	authorityRevision: string;
}

export interface OwnerAuthority extends AuthenticatedAuthority {
	role: "Owner";
}

export interface ProductSpecApprovalEnvelope {
	schema: "product-spec-approval";
	schemaVersion: 1;
	payload: {
		actor: OwnerAuthority;
		target: ProductSpecTarget;
		revision: string;
		specDigest: string;
	};
	digest: string;
}

export interface ApprovedProductSpecSnapshot {
	spec: ProductSpecEnvelope;
	approval: ProductSpecApprovalEnvelope;
}

export interface DeliveryParentSnapshot {
	schema: "delivery-parent";
	schemaVersion: 1;
	payload: {
		id: string;
		teamId: string;
		revision: string;
		specDigest: string;
	};
	digest: string;
}

export interface DesignExplorationBinding {
	kind: "design-exploration";
	assignmentId: string;
	definitionId: string;
	intent: "prototype" | "design-alternative";
	focus: string;
	domainAnchorDigest: string;
	sourceArtifacts: readonly VerifiedArtifactRef[];
	skillRefs: readonly DigestedRef[];
	standardRefs: readonly DigestedRef[];
	launchProvenance: ExactLaunchProvenance;
}

export interface DesignExplorationSnapshot {
	summary: string;
	comparison: readonly {
		criterion: string;
		assessment: string;
	}[];
	changedPaths: readonly string[];
	limitations: readonly string[];
}

export interface DesignExplorationEnvelope {
	schema: "design-exploration";
	schemaVersion: 1;
	payload: Omit<DesignExplorationBinding, "kind"> &
		DesignExplorationSnapshot & {
			progressBatches: readonly StoredProgressBatch[];
		};
	digest: string;
}

export type ArtifactBinding = ResearchArtifactBinding | DesignExplorationBinding;

interface ArtifactSessionCapability {
	read(alias: string): Promise<StoredArtifactRead>;
	readCurrent(): Promise<StoredArtifactRead | undefined>;
	writeDeliveryTicketGraph(
		graph: import("./delivery-ticket-graph.ts").DeliveryTicketGraph,
		expectedRevision?: string,
	): Promise<VerifiedArtifactRef>;
	writeSnapshot(
		envelope: ResearchEvidenceEnvelope,
		expectedRevision?: string,
	): Promise<VerifiedArtifactRef>;
	writeExplorationSnapshot(
		snapshot: DesignExplorationSnapshot,
		expectedRevision?: string,
	): Promise<VerifiedArtifactRef>;
	mergeProgress(batch: ProgressBatch): Promise<VerifiedArtifactRef>;
	verifyDiscoveredPaths(
		paths: readonly string[],
		artifacts: readonly VerifiedArtifactRef[],
	): Promise<readonly string[]>;
	hasVerifiedArtifact(artifact: VerifiedArtifactRef): boolean;
}

export interface PreparedLaunch {
	intent: WorkflowIntent;
	prompt: string;
	skillRefs: readonly DigestedRef[];
	standardRefs: readonly DigestedRef[];
	artifactGrant: ArtifactGrant;
	artifactSession: ArtifactSessionCapability;
	launchProvenance: ExactLaunchProvenance;
	fingerprint: string;
}

interface WorkflowRisk {
	kind: "workflow";
	id: string;
	severity: "warning" | "critical";
	summary: string;
	evidence?: VerifiedArtifactRef;
}

interface CompletedSubagentResult {
	status: "completed";
	executiveSummary: string;
	artifacts: readonly VerifiedArtifactRef[];
	nextRecommended:
		| {
				kind: "confirmed-route";
				route: Route;
		  }
		| {
				kind: "compare-exploration";
				intent: "prototype" | "design-alternative";
		  };
	risks: readonly WorkflowRisk[];
	launchProvenance: ExactLaunchProvenance;
}

interface BlockedSubagentResult {
	status: "blocked";
	executiveSummary: string;
	artifacts: readonly VerifiedArtifactRef[];
	nextRecommended: {
		kind: "owner-action";
	};
	risks: readonly WorkflowRisk[];
	blocker: WorkflowBlocker;
	launchProvenance?: ExactLaunchProvenance;
}

export type SubagentResult = CompletedSubagentResult | BlockedSubagentResult;

interface BaseWorkflowIntent {
	requestId: string;
	definitionId: string;
	recommendationDigest: string;
	route: Route;
	domainAnchorDigest: string;
	project: ProjectRef;
	targetTopic: string;
	requiredSkills: readonly SkillRequirement[];
	affectedPaths: readonly string[];
}

interface ResearchIntent extends BaseWorkflowIntent {
	kind: "research";
	question: string;
}

interface ExplorationIntent extends BaseWorkflowIntent {
	kind: "prototype" | "design-alternative";
	focus: string;
	readableArtifacts: readonly {
		alias: string;
		ref: VerifiedArtifactRef;
	}[];
}

interface TicketGraphIntent extends BaseWorkflowIntent {
	kind: "to-tickets";
	approvedSpec: VerifiedArtifactRef;
	deliveryParent: VerifiedArtifactRef;
}

export type WorkflowIntent = ResearchIntent | ExplorationIntent | TicketGraphIntent;

export type Intervention =
	| { kind: "steer"; guidance: string }
	| { kind: "cancel"; reason: string };

export interface DelegationCheckpoint {
	identity: string;
	intentFingerprint: string;
	launchFingerprint: string;
	sessionId?: string;
	attempt: 1 | 2;
	interventions: readonly Intervention[];
	state:
		| "running"
		| "interrupted"
		| "completed"
		| "blocked"
		| "cancelled";
	verifiedArtifacts: readonly VerifiedArtifactRef[];
	updatedAt: number;
}

export interface PrepareLaunchValidation {
	assetVersion: number;
	assetDigest: string;
	allowedTools: readonly string[];
	deniedCapabilities: readonly string[];
}

export function createBlocker(
	code: WorkflowBlockerCode,
	message: string,
): WorkflowBlocker {
	return { code, message };
}

function normalizeJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalizeJson);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, entry]) => entry !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, normalizeJson(entry)]),
		);
	}
	return value;
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(normalizeJson(value));
}

export function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function digestCanonicalValue(value: unknown): string {
	return sha256Hex(canonicalJson(value));
}

export function createRouteRecommendation(input: {
	definitionId: string;
	domainAnchor: string;
	assessment: Assessment;
	issuedAt: number;
}): RouteRecommendation {
	const domainAnchor = input.domainAnchor.trim();
	const recommendedRoute: Route =
		input.assessment.clarity === "unclear" ||
		input.assessment.breadth === "broad"
			? "wayfinder"
			: "grilling";
	const base = {
		assessment: input.assessment,
		definitionId: input.definitionId,
		issuedAt: input.issuedAt,
		domainAnchor,
		domainAnchorDigest: sha256Hex(domainAnchor),
		recommendedRoute,
	};
	return {
		...base,
		digest: digestCanonicalValue(base),
		confirmationToken: randomBytes(32).toString("base64url"),
	};
}

export function createResearchEvidenceEnvelope(
	payload: ResearchEvidenceV1,
): ResearchEvidenceEnvelope {
	const unsigned = {
		schema: "research-evidence" as const,
		schemaVersion: 1 as const,
		payload,
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

export function sameLaunchProvenance(
	left: ExactLaunchProvenance | undefined,
	right: ExactLaunchProvenance,
): boolean {
	return left !== undefined && canonicalJson(left) === canonicalJson(right);
}
