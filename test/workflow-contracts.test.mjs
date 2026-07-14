import test from "node:test";
import assert from "node:assert/strict";

import {
	canonicalJson,
	createResearchEvidenceEnvelope,
	createRouteRecommendation,
	digestCanonicalValue,
	sha256Hex,
} from "../extensions/workflow-contracts.ts";

test("route recommendation uses explicit clarity and breadth semantics", () => {
	const wayfinder = createRouteRecommendation({
		definitionId: "definition-1",
		domainAnchor: "  Explore an uncertain product space  ",
		assessment: {
			clarity: "unclear",
			breadth: "narrow",
			reasons: ["missing outcome"],
		},
		issuedAt: 1_000,
	});
	assert.equal(wayfinder.recommendedRoute, "wayfinder");
	assert.equal(
		wayfinder.domainAnchorDigest,
		sha256Hex("Explore an uncertain product space"),
	);

	const grilling = createRouteRecommendation({
		definitionId: "definition-2",
		domainAnchor: "Validate one checkout flow",
		assessment: {
			clarity: "clear",
			breadth: "narrow",
			reasons: ["single flow"],
		},
		issuedAt: 2_000,
	});
	assert.equal(grilling.recommendedRoute, "grilling");
});

test("canonical digests ignore key order and react to value changes", () => {
	const left = digestCanonicalValue({ b: 2, a: { d: 4, c: 3 } });
	const right = digestCanonicalValue({ a: { c: 3, d: 4 }, b: 2 });
	const changed = digestCanonicalValue({ a: { c: 99, d: 4 }, b: 2 });
	assert.equal(left, right);
	assert.notEqual(left, changed);
	assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test("research evidence envelope digest excludes the digest field itself", () => {
	const payload = {
		assignmentId: "request-1",
		definitionId: "definition-1",
		recommendationDigest: "rec-digest",
		route: "grilling",
		question: "What should we verify?",
		domainAnchorDigest: "anchor-digest",
		findings: [
			{
				claim: "One",
				evidence: [
					{
						uri: "https://example.com",
						title: "Example",
						retrievedAt: "2026-07-11T00:00:00.000Z",
					},
				],
			},
		],
		limitations: [],
		skillRefs: [],
		standardRefs: [],
		launchProvenance: {
			agentName: "research",
			assetVersion: 1,
			assetDigest: "asset-digest",
			capabilityProfile: "research-reader",
			provider: "openai-codex",
			model: "gpt-5.6-terra",
			effort: "medium",
			inheritContext: false,
			promptMode: "replace",
			skillRefs: [],
			standardRefs: [],
			allowedTools: ["read"],
			deniedCapabilities: ["bash"],
			artifactTopic: "workflow/define-product/definition-1/research/request-1",
		},
	};
	const envelope = createResearchEvidenceEnvelope(payload);
	assert.equal(
		envelope.digest,
		digestCanonicalValue({
			schema: envelope.schema,
			schemaVersion: envelope.schemaVersion,
			payload,
		}),
	);
});
