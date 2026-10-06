import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { createChildLauncher } from "../extensions/child-launcher.ts";
import { delegationCases } from "../extensions/delegation-check.ts";
import { turnJevRoutingOn } from "./support/jev-routing.mjs";

const jevRouting = turnJevRoutingOn();

const enabled =
	process.env.PI_WORKFLOW_JEV_LIVE === "1" &&
	Boolean(process.env.TYPESAFE_API_KEY);
const skip = enabled
	? false
	: "Set PI_WORKFLOW_JEV_LIVE=1 and TYPESAFE_API_KEY to enable the live Jev delegation checks.";

const root = fileURLToPath(new URL("..", import.meta.url));
const absentProfiles = { load: () => ({ status: "absent" }) };

async function recordingRegistry(dir, requests) {
	const runtime = await ModelRuntime.create({
		authPath: join(dir, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	const modelRegistry = new ModelRegistry(runtime);
	const classify = modelRegistry.classify.bind(modelRegistry);
	modelRegistry.classify = (model, context, options) => {
		requests.push(context);
		return classify(model, context, options);
	};
	return modelRegistry;
}

test(
	"live Jev selects the specialist for every live delegation case",
	{ skip, timeout: 120_000 },
	async (t) => {
		const dir = await mkdtemp(join(tmpdir(), "pi-workflow-jev-live-"));
		t.after(() => rm(dir, { recursive: true, force: true }));
		const requests = [];
		const modelRegistry = await recordingRegistry(dir, requests);
		const decide = (request) =>
			createChildLauncher({
				modelProfiles: absentProfiles,
				jevRouting,
			}).prepareLaunch(
				request,
				{
					cwd: root,
					model: { provider: "session", id: "model", reasoning: true },
					thinkingLevel: "medium",
					modelRegistry,
				},
			);
		const specialists = {
			explore: "explorer",
			worker: "worker",
			verify: "verifier",
		};
		for (const item of delegationCases.filter((candidate) => candidate.live)) {
			const before = requests.length;
			const result = await decide({
				task: item.task,
				userRequest: item.userRequest,
				...(item.suggestedRole ? { role: item.suggestedRole } : {}),
			});
			assert.equal(
				result.kind,
				"ready",
				`${item.name}: ${result.reason ?? result.warning ?? ""}`,
			);
			assert.equal(result.role, item.expected.role, item.name);
			const body = requests[before];
			assert.equal(body.state.user_request, item.userRequest, item.name);
			if (item.suggestedRole) {
				assert.equal(
					body.state.suggested_specialist,
					specialists[item.suggestedRole],
					item.name,
				);
				assert.equal(body.questions.destination.type, "choice", item.name);
			}
		}
	},
);
