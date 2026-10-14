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
const delegationMode = { current: () => "opportunistic" };

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
	"live Jev lets every live delegation case leave with the parent's role",
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
				delegationMode,
			}).prepareLaunch(
				request,
				{
					cwd: root,
					model: { provider: "session", id: "model", reasoning: true },
					thinkingLevel: "medium",
					modelRegistry,
				},
			);
		for (const item of delegationCases.filter((candidate) => candidate.live)) {
			const before = requests.length;
			const result = await decide({
				role: "worker",
				task: item.task,
				userRequest: item.userRequest,
			});
			assert.equal(
				result.kind,
				"ready",
				`${item.name}: ${result.reason ?? result.warning ?? ""}`,
			);
			assert.equal(result.role, "worker", item.name);
			const body = requests[before];
			assert.equal(body.state.user_request, item.userRequest, item.name);
			assert.deepEqual(Object.keys(body.questions), ["destination"], item.name);
		}
	},
);
