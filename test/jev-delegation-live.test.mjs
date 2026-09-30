import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createChildLauncher } from "../extensions/child-launcher.ts";
import { delegationCases } from "../extensions/delegation-check.ts";

const enabled =
	process.env.PI_WORKFLOW_JEV_LIVE === "1" &&
	Boolean(process.env.TYPESAFE_API_KEY);
const skip = enabled
	? false
	: "Set PI_WORKFLOW_JEV_LIVE=1 and TYPESAFE_API_KEY to enable the live Jev delegation checks.";

const root = fileURLToPath(new URL("..", import.meta.url));
const absentProfiles = { load: () => ({ status: "absent" }) };

function context() {
	return {
		cwd: root,
		model: { provider: "session", id: "model", reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: {
			getApiKeyForProvider: async (provider) =>
				provider === "typesafe" ? process.env.TYPESAFE_API_KEY : undefined,
			getAvailable: () => [],
		},
	};
}

test(
	"live Jev selects the specialist for four clear delegation cases",
	{ skip, timeout: 120_000 },
	async () => {
		const requests = [];
		const fetch = async (url, init) => {
			requests.push(JSON.parse(init.body));
			return globalThis.fetch(url, init);
		};
		const decide = (request) =>
			createChildLauncher({
				modelProfiles: absentProfiles,
				fetch,
			}).decide(request, context());
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
				result.status,
				"launch",
				`${item.name}: ${result.reason ?? result.warning ?? ""}`,
			);
			assert.equal(result.role, item.expected.role, item.name);
			const body = requests[before];
			assert.equal(body.state.user_request, item.userRequest, item.name);
			if (!item.expected.destinationAsked) {
				assert.equal(body.state.delegation_intent, "explicit", item.name);
				assert.equal(body.questions.destination, undefined, item.name);
			}
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
