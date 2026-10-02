import test from "node:test";
import assert from "node:assert/strict";

import { capabilities, replaceSelection } from "../extensions/configure.ts";
import { delegationCases, runDelegationCheck } from "../extensions/delegation-check.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { turnJevRoutingOn, withAgentDirectory } from "./support/jev-routing.mjs";

turnJevRoutingOn();

const absentProfiles = { load: () => ({ status: "absent" }) };

function choiceAnswer(choice, criteria, confidence = 0.91) {
	return {
		type: "choice",
		choice,
		confidence,
		probabilities: Object.fromEntries(
			Object.keys(criteria ?? {}).map((key) => [key, key === choice ? 1 : 0]),
		),
	};
}

function specialistFor(item) {
	if (item.expected.role === "explore") return "explorer";
	if (item.expected.role === "verify") return "verifier";
	return "worker";
}

function destinationFor(item) {
	if (item.expected.action === "stay") return "stay";
	if (item.expected.action === "decide") return "decide";
	return "leave";
}

function answeringFetch(fixed) {
	const requests = [];
	const fetch = async (_url, init) => {
		const body = JSON.parse(init.body);
		requests.push(body);
		const item =
			fixed ??
			delegationCases.find(
				(candidate) => candidate.userRequest === body.state.user_request,
			);
		const questions = body.questions ?? {};
		const answers = {};
		if (questions.specialist) {
			answers.specialist = choiceAnswer(
				specialistFor(item),
				questions.specialist.criteria,
			);
		}
		if (questions.destination) {
			answers.destination = choiceAnswer(
				destinationFor(item),
				questions.destination.criteria,
			);
		}
		return Response.json({ model: "jev-1.13.0", id: "req-1", answers });
	};
	return { fetch, requests };
}

function context(apiKey = "typesafe-key") {
	return {
		cwd: "/work",
		model: { provider: "session", id: "model", reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: {
			getApiKeyForProvider: async (provider) =>
				provider === "typesafe" ? apiKey : undefined,
			getAvailable: () => [],
		},
	};
}

test("delegation check scores the fixed cases against Jev answers and skips the network for a skill", async () => {
	const jev = answeringFetch();
	const { lines, failed } = await runDelegationCheck(context(), {
		fetch: jev.fetch,
		modelProfiles: absentProfiles,
	});

	assert.equal(failed, false);
	assert.equal(lines.length, delegationCases.length);
	assert.equal(lines.filter((line) => line.startsWith("pass:")).length, lines.length);
	assert.match(
		lines.find((line) => line.startsWith("pass: bounded implementation")),
		/action launch, specialist worker, destination asked yes/,
	);
	assert.match(
		lines.find((line) => line.startsWith("pass: bounded implementation")),
		/specialist choice worker/,
	);
	assert.match(
		lines.find((line) => line.startsWith("pass: bounded implementation")),
		/confidence 0\.91/,
	);
	assert.match(
		lines.find((line) => line.startsWith("pass: bounded implementation")),
		/probabilities /,
	);
	assert.match(
		lines.find((line) => line.startsWith("pass: open product decision")),
		/action decide, destination asked yes/,
	);
	assert.match(
		lines.find((line) => line.startsWith("pass: open product decision")),
		/destination choice decide/,
	);
	assert.match(
		lines.find((line) => line.startsWith("pass: small understood answer")),
		/action stay, destination asked yes/,
	);
	assert.match(
		lines.find((line) => line.startsWith("pass: explicit architecture research")),
		/destination asked no/,
	);
	const skill = lines.find((line) => line.startsWith("pass: implement skill"));
	assert.match(skill, /action launch, specialist worker, destination asked no/);
	assert.doesNotMatch(skill, /confidence/);
	assert.equal(
		jev.requests.some(
			(body) => body.state.user_request === "Usa la skill implement para este ticket.",
		),
		false,
	);
	assert.equal(jev.requests.length, delegationCases.filter((item) => item.expected.callsJev).length);
});

test("delegation check names the mismatched specialist and does not launch a child", async () => {
	const jev = answeringFetch({
		expected: { action: "launch", role: "explore" },
	});
	const { lines, failed } = await runDelegationCheck(context(), {
		fetch: jev.fetch,
		modelProfiles: absentProfiles,
	});

	assert.equal(failed, true);
	assert.match(
		lines.find((line) => line.startsWith("fail: bounded implementation")),
		/specialist expected worker, got explore/,
	);
	assert.match(
		lines.find((line) => line.startsWith("fail: open product decision")),
		/action expected decide, got launch/,
	);
	assert.equal(lines.some((line) => /child .*queued|spawn_child/.test(line)), false);
});

test("a missing TypeSafe key is a fail line and the skill case still runs", async () => {
	const jev = answeringFetch();
	const { lines, failed } = await runDelegationCheck(context(null), {
		fetch: jev.fetch,
		modelProfiles: absentProfiles,
	});

	assert.equal(failed, true);
	assert.equal(jev.requests.length, 0);
	for (const item of delegationCases.filter((candidate) => candidate.expected.callsJev)) {
		assert.match(
			lines.find((line) => line.startsWith(`fail: ${item.name}`)),
			/TypeSafe API key is missing/,
		);
	}
	assert.match(
		lines.find((line) => line.startsWith("pass: implement skill")),
		/specialist worker/,
	);
});

test("Jev routing off fails every Jev case without calling Jev and still runs the skill case", async (t) => {
	withAgentDirectory(t);
	const jev = answeringFetch();

	const { lines, failed } = await runDelegationCheck(context(), {
		fetch: jev.fetch,
		modelProfiles: absentProfiles,
	});

	assert.equal(failed, true);
	assert.equal(jev.requests.length, 0);
	assert.equal(lines.length, delegationCases.length);
	for (const item of delegationCases.filter((candidate) => candidate.expected.callsJev)) {
		assert.ok(
			lines.includes(
				`fail: ${item.name}: Jev routing is off. Turn it on in /workflow:settings.`,
			),
		);
	}
	assert.match(
		lines.find((line) => line.startsWith("pass: implement skill")),
		/specialist worker/,
	);
});

test("/workflow:delegation-check rejects extra arguments and reports a missing key without throwing", async () => {
	replaceSelection({
		schemaVersion: 1,
		capabilities: Object.fromEntries(capabilities.map((capability) => [capability, true])),
		expectations: {},
	});
	const commands = new Map();
	const notifications = [];
	piWorkflowExtension(
		{
			on() {},
			exec: async () => ({ code: 0 }),
			registerCommand: (name, command) => commands.set(name, command),
			registerTool() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			registerProvider() {},
			sendMessage() {},
		},
		{},
	);
	const command = commands.get("workflow:delegation-check");
	const ui = {
		notify: (message, level) => notifications.push({ message, level }),
		custom: () => assert.fail("the check must not open a panel"),
	};

	await command.handler("--force", { hasUI: true, mode: "tui", ui });
	assert.match(notifications[0].message, /\/workflow:delegation-check/);
	assert.equal(notifications[0].level, "error");

	await command.handler("", {
		hasUI: true,
		mode: "tui",
		ui,
		cwd: "/work",
		model: undefined,
		thinkingLevel: undefined,
		modelRegistry: {
			getApiKeyForProvider: async () => undefined,
			getAvailable: () => [],
		},
	});
	assert.equal(notifications[1].level, "error");
	assert.match(notifications[1].message, /TypeSafe API key is missing/);
	assert.match(notifications[1].message, /pass: implement skill/);
});
