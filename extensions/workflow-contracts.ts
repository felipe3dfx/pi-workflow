import { createHash, randomBytes } from "node:crypto";

export type Route = "wayfinder" | "grilling";
type Clarity = "clear" | "unclear";
type Breadth = "narrow" | "broad";
type ArtifactSchema = "research-evidence";
type ArtifactStrategy = "snapshot";
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
	| "PI_WORKFLOW_INTENT_UNSUPPORTED"
	| "PI_WORKFLOW_INTERVENTION_UNSUPPORTED";

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
	topic: string;
	schema: ArtifactSchema;
	schemaVersion: 1;
	strategy: ArtifactStrategy;
	aliases: readonly [];
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

export interface ResearchArtifactBinding {
	assignmentId: string;
	definitionId: string;
	recommendationDigest: string;
	route: Route;
	question: string;
	domainAnchorDigest: string;
}

export interface ExactLaunchProvenance {
	agentName: "research";
	assetVersion: number;
	assetDigest: string;
	capabilityProfile: "research-reader";
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
	schema: ArtifactSchema;
	schemaVersion: 1;
	payload: ResearchEvidenceV1;
	digest: string;
}

interface ArtifactSessionCapability {
	readCurrent(): Promise<StoredArtifactRead | undefined>;
	writeSnapshot(
		envelope: ResearchEvidenceEnvelope,
	): Promise<VerifiedArtifactRef>;
	hasVerifiedArtifact(artifact: VerifiedArtifactRef): boolean;
}

export interface PreparedLaunch {
	intent: ResearchIntent;
	prompt: string;
	skillRefs: readonly DigestedRef[];
	standardRefs: readonly DigestedRef[];
	artifactGrant: ArtifactGrant;
	artifactSession: ArtifactSessionCapability;
	launchProvenance: ExactLaunchProvenance;
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
	nextRecommended: {
		kind: "confirmed-route";
		route: Route;
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

export interface ResearchIntent {
	kind: "research";
	requestId: string;
	definitionId: string;
	recommendationDigest: string;
	route: Route;
	question: string;
	domainAnchorDigest: string;
	project: ProjectRef;
	targetTopic: string;
	requiredSkills: readonly SkillRequirement[];
	affectedPaths: readonly string[];
}

export type WorkflowIntent = ResearchIntent;

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
