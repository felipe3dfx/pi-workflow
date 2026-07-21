export type WorkflowReadiness = "ready" | "degraded" | "blocked";
type DiagnosticCheckStatus = "pass" | "fail" | "unknown";

export type DiagnosticScope =
	| { readonly kind: "installation" }
	| { readonly kind: "product"; readonly teamId: string }
	| { readonly kind: "delivery"; readonly issueId: string }
	| { readonly kind: "qa-handoff"; readonly issueId: string }
	| { readonly kind: "product-review"; readonly issueId: string };

type DiagnosticCheckId =
	| "provider-model-effort"
	| "authentication"
	| "capabilities"
	| "permissions"
	| "agent-assets"
	| "schemas"
	| "project-over-global-override"
	| "installation"
	| "product-publication"
	| "delivery-ticket"
	| "qa-handoff-issue"
	| "product-review-issue";

interface DiagnosticCheckRequest {
	readonly id: DiagnosticCheckId;
	readonly scope: DiagnosticScope;
	readonly mode: "read-only";
}

export interface DiagnosticCheckResult {
	readonly id: DiagnosticCheckId;
	readonly status: DiagnosticCheckStatus;
	readonly evidence: unknown;
	readonly remediation: string;
}

export interface WorkflowDiagnosticsAdapter {
	check(request: DiagnosticCheckRequest): Promise<DiagnosticCheckResult> | DiagnosticCheckResult;
}

interface SummaryCheck {
	readonly id: DiagnosticCheckId;
	readonly status: DiagnosticCheckStatus;
	readonly required: true;
}

interface DoctorCheck extends SummaryCheck {
	readonly evidence: unknown;
	readonly remediation: string;
}

export interface WorkflowStatusReport {
	readonly scope: string;
	readonly readiness: WorkflowReadiness;
	readonly checks: readonly SummaryCheck[];
}

export interface WorkflowDoctorReport {
	readonly scope: string;
	readonly readiness: WorkflowReadiness;
	readonly checks: readonly DoctorCheck[];
}

const commonChecks: readonly DiagnosticCheckId[] = [
	"provider-model-effort",
	"authentication",
	"capabilities",
	"permissions",
	"agent-assets",
	"schemas",
	"project-over-global-override",
];

const operationCheck: Record<DiagnosticScope["kind"], DiagnosticCheckId> = {
	installation: "installation",
	product: "product-publication",
	delivery: "delivery-ticket",
	"qa-handoff": "qa-handoff-issue",
	"product-review": "product-review-issue",
};

const sensitiveKey = /(?:auth|credential|password|secret|token|api[-_]?key)/i;
const sensitiveValue = /(?:bearer\s+\S+|\bsk-[A-Za-z0-9_-]+)/i;

function redactEvidence(value: unknown, key?: string): unknown {
	if (key && sensitiveKey.test(key)) return "[REDACTED]";
	if (typeof value === "string" && sensitiveValue.test(value)) return "[REDACTED]";
	if (Array.isArray(value)) return value.map((entry) => redactEvidence(entry));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([entryKey, entryValue]) => [
				entryKey,
				redactEvidence(entryValue, entryKey),
			]),
		);
	}
	if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
	return String(value);
}

function scopeName(scope: DiagnosticScope): string {
	switch (scope.kind) {
		case "installation":
			return scope.kind;
		case "product":
			return `${scope.kind}:${scope.teamId}`;
		case "delivery":
		case "qa-handoff":
		case "product-review":
			return `${scope.kind}:${scope.issueId}`;
	}
}

function normalizeResult(
	id: DiagnosticCheckId,
	value: DiagnosticCheckResult,
): DiagnosticCheckResult {
	if (
		value.id !== id ||
		!(["pass", "fail", "unknown"] as const).includes(value.status) ||
		typeof value.remediation !== "string" ||
		value.remediation.trim().length === 0
	) {
		return {
			id,
			status: "unknown",
			evidence: { reason: "invalid diagnostic adapter result" },
			remediation:
				"Repair the diagnostic adapter so it returns the requested stable check ID, status, evidence, and remediation.",
		};
	}
	return value;
}

function readiness(results: readonly DiagnosticCheckResult[], strict: boolean): WorkflowReadiness {
	if (results.some((result) => result.status === "fail" || (strict && result.status === "unknown"))) {
		return "blocked";
	}
	return results.some((result) => result.status === "unknown") ? "degraded" : "ready";
}

export function createWorkflowDiagnostics(options: {
	readonly adapter: WorkflowDiagnosticsAdapter;
	readonly strictCompatibility: boolean;
}) {
	async function run(scope: DiagnosticScope): Promise<DiagnosticCheckResult[]> {
		const ids = [...commonChecks, operationCheck[scope.kind]];
		return Promise.all(
			ids.map(async (id) =>
				normalizeResult(
					id,
					await options.adapter.check({ id, scope, mode: "read-only" }),
				),
			),
		);
	}

	async function inspect(scope: DiagnosticScope): Promise<WorkflowStatusReport> {
		const results = await run(scope);
		return {
			scope: scopeName(scope),
			readiness: readiness(results, options.strictCompatibility),
			checks: results.map(({ id, status }) => ({ id, status, required: true })),
		};
	}

	async function diagnose(scope: DiagnosticScope): Promise<WorkflowDoctorReport> {
		const results = await run(scope);
		return {
			scope: scopeName(scope),
			readiness: readiness(results, options.strictCompatibility),
			checks: results.map(({ id, status, evidence, remediation }) => ({
				id,
				status,
				required: true,
				evidence: redactEvidence(evidence),
				remediation,
			})),
		};
	}

	return { inspect, diagnose };
}
