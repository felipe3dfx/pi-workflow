import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CORPUS_SHA256,
	LIMITS,
	PROMPT,
	classifyOne,
	hash,
	loadCorpus,
	matrix,
} from "./classifier.mjs";

const args = process.argv.slice(2);
const corpus = loadCorpus(
	readFileSync(new URL("./cases.json", import.meta.url), "utf8"),
);

function options(args) {
	if (args.length === 0) return null;
	if (
		args.length !== 7 ||
		args[0] !== "--live" ||
		args[1] !== "--provider" ||
		args[3] !== "--model" ||
		args[5] !== "--corpus-sha256" ||
		!args[2] ||
		!args[4] ||
		args[6] !== CORPUS_SHA256
	)
		throw new Error("Invalid live opt-in");
	return { provider: args[2], model: args[4] };
}

async function main() {
	const selected = options(args);
	if (!selected) {
		console.log(
			JSON.stringify(
				{
					mode: "offline-manifest",
					corpusHash: CORPUS_SHA256,
					promptHash: hash(PROMPT),
					semanticCases: corpus.cases.length,
					contexts: matrix(corpus).length,
					limits: LIMITS,
					inferenceCalls: 0,
					verdict: "Live evidence not collected",
				},
				null,
				2,
			),
		);
		return;
	}
	const deadline = setTimeout(
		() => {
			console.error(
				"Live harness hard deadline exceeded; incomplete evidence, escalate to user.",
			);
			process.exit(124);
		},
		LIMITS.calls * LIMITS.timeoutMs + 30_000,
	);
	try {
		const { getAgentDir, ModelRegistry, ModelRuntime, readStoredCredential } =
			await import("@earendil-works/pi-coding-agent");
		const credential = readStoredCredential(
			selected.provider,
			join(getAgentDir(), "auth.json"),
		);
		if (!credential) throw new Error("Stored credential unavailable");
		const credentials = {
			async read(providerId) {
				return providerId === selected.provider ? credential : undefined;
			},
			async list() {
				return [{ providerId: selected.provider, type: credential.type }];
			},
			async modify() {
				throw new Error("Read-only credentials refuse persistence");
			},
			async delete() {
				throw new Error("Read-only credentials refuse deletion");
			},
		};
		const runtime = await ModelRuntime.create({
			credentials,
			modelsPath: null,
			refreshOnCreate: false,
			allowModelNetwork: false,
		});
		const registry = new ModelRegistry(runtime);
		const model = registry.find(selected.provider, selected.model);
		if (!model || !runtime.getPhysicalModel(selected.provider, selected.model))
			throw new Error("Explicit physical catalog model unavailable");
		const evidence = {
			mode: "live",
			corpusHash: CORPUS_SHA256,
			promptHash: hash(PROMPT),
			provider: selected.provider,
			model: selected.model,
			maxCalls: LIMITS.calls,
			startedAt: new Date().toISOString(),
			records: [],
		};
		for (const context of matrix(corpus)) {
			const c = corpus.cases.find((item) => item.id === context.id);
			const record = await classifyOne({
				c,
				context,
				...selected,
				invoke: (request, options) =>
					runtime.completeSimple(model, request, {
						...options,
						timeoutMs: LIMITS.timeoutMs,
					}),
			});
			evidence.records.push(record);
			if (
				["request_failure", "aborted", "timeout", "model_mismatch"].includes(
					record.status,
				)
			)
				break;
		}
		const output = `${JSON.stringify(evidence, null, 2)}\n`;
		if (evidence.records.some((r) => r.status === "timeout")) {
			// Abort is advisory: terminate any lingering SDK resources after flushing evidence.
			await new Promise(() => {
				process.stdout.write(output, () => process.exit(1));
			});
		}
		process.stdout.write(output);
		if (
			evidence.records.some((r) => r.status !== "ok") ||
			evidence.records.length !== LIMITS.calls
		)
			process.exitCode = 1;
	} finally {
		clearTimeout(deadline);
	}
}

try {
	await main();
} catch {
	// SDK errors can embed tokens, headers, endpoints, or file paths.
	console.error(
		"Harness unavailable: invalid opt-in, catalog, credentials, or SDK setup. Escalate to user; no fallback.",
	);
	process.exitCode = 1;
}
