import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createChildLauncher } from "../extensions/child-launcher.ts";

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
		const cases = [
			{
				name: "explicit architecture research",
				request: {
					task: "Map how the two implementations fit together.",
					userRequest:
						"Investiga con un hijo la arquitectura de estas dos implementaciones y cómo encajan.",
				},
				role: "explore",
				explicit: true,
			},
			{
				name: "suggested worker plus source comparison",
				request: {
					role: "worker",
					task: "Compare the two cited source files and report how they differ.",
					userRequest:
						"Compare the two cited source implementations and report how they differ. The comparison is bounded and can be finished alone.",
				},
				role: "explore",
				suggested: "worker",
			},
			{
				name: "bounded implementation",
				request: {
					task: "Implement the missing export and its unit test.",
					userRequest:
						"Implement the missing export and a unit test that covers it. The change is bounded and can be finished alone.",
				},
				role: "worker",
			},
			{
				name: "independent check",
				request: {
					task: "Independently check the completed change.",
					userRequest:
						"Haz una comprobación independiente del cambio que ya está hecho. La revisión está acotada y se puede terminar sola.",
				},
				role: "verify",
			},
		];

		for (const item of cases) {
			const before = requests.length;
			const result = await decide(item.request);
			assert.equal(
				result.status,
				"launch",
				`${item.name}: ${result.reason ?? result.warning ?? ""}`,
			);
			assert.equal(result.role, item.role, item.name);
			const body = requests[before];
			assert.equal(body.state.user_request, item.request.userRequest, item.name);
			if (item.explicit) {
				assert.equal(body.state.delegation_intent, "explicit", item.name);
				assert.equal(body.questions.destination, undefined, item.name);
			}
			if (item.suggested) {
				assert.equal(body.state.suggested_specialist, item.suggested, item.name);
				assert.equal(body.questions.destination.type, "choice", item.name);
			}
		}
	},
);
