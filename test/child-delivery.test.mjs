import test from "node:test";
import assert from "node:assert/strict";

import { capabilities, replaceSelection } from "../extensions/configure.ts";
import { recordingCore } from "./support/fake-children.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));

function workerResult(verdict, reason = `The work is ${verdict}.`) {
	return {
		verdict,
		reason,
		files_changed: ["src/a.ts: fixed the parser"],
		validation: ["npm test: 12 passed"],
		left_undone: [],
	};
}

function verifyResult(verdict) {
	return {
		verdict,
		reason: `The check is ${verdict}.`,
		findings: [],
		unverified: [],
	};
}

const ids = (message) =>
	(message.details.results ?? [message.details]).map((details) => details.id);

async function finish({ child }, verdict, text = "Answer.") {
	if (verdict) child.spec.report(verdict);
	child.result.resolve(text);
	await settle();
}

for (const [name, role, result] of [
	["done", "worker", workerResult("done")],
	["pass", "verify", verifyResult("pass")],
	["an absent Verdict", "worker", undefined],
]) {
	test(`a completed result with ${name} stays pending while a sibling works, at every boundary`, async () => {
		const delivery = recordingCore();
		const quiet = await delivery.launch(role);
		await delivery.launch();

		await finish(quiet, result);
		delivery.core.atBoundary();
		delivery.core.atBoundary();

		assert.deepEqual(delivery.sent, []);
	});
}

for (const [name, end] of [
	[
		"fails",
		({ child }) => child.result.reject(new Error("provider overloaded")),
	],
	["is cancelled", ({ id }, core) => core.cancel(id, true)],
	["reports blocked", (waker) => finish(waker, workerResult("blocked"))],
	["reports partial", (waker) => finish(waker, workerResult("partial"))],
	["reports fail", (waker) => finish(waker, verifyResult("fail"), "Fail.")],
]) {
	test(`a result that ${name} wakes the parent at the next boundary with every pending result in one message`, async () => {
		const delivery = recordingCore();
		const quiet = await delivery.launch();
		const waker = await delivery.launch(
			name === "reports fail" ? "verify" : "worker",
		);
		await delivery.launch();
		await finish(quiet, workerResult("done"));

		await end(waker, delivery.core);
		await settle();
		assert.deepEqual(delivery.sent, []);
		delivery.core.atBoundary();

		assert.equal(delivery.sent.length, 1);
		assert.deepEqual(ids(delivery.sent[0]), [quiet.id, waker.id]);
	});
}

test("a timed-out result wakes the parent with every pending result", async () => {
	const timers = [];
	const delivery = recordingCore({
		schedule: (run) => {
			timers.push(run);
			return () => {};
		},
	});
	const quiet = await delivery.launch();
	const waker = await delivery.launch();
	await delivery.launch();
	await finish(quiet);

	timers[1]();
	delivery.core.atBoundary();

	assert.equal(delivery.sent.length, 1);
	assert.deepEqual(ids(delivery.sent[0]), [quiet.id, waker.id]);
	assert.equal(delivery.sent[0].details.results[1].state, "timed out");
});

test("the last child settling wakes the parent with every pending result in one message, in the order they ended", async () => {
	const delivery = recordingCore();
	const first = await delivery.launch();
	const second = await delivery.launch("verify");

	await finish(first, workerResult("done"), "First answer.");
	delivery.core.atBoundary();
	await finish(second, undefined, "Second answer.");
	delivery.core.atBoundary();
	delivery.core.atBoundary();

	assert.equal(delivery.sent.length, 1);
	const [message] = delivery.sent;
	assert.equal(message.customType, "pi-workflow-child-result");
	assert.equal(message.display, true);
	assert.equal(
		message.content,
		`Child ${first.id} completed. Verdict: done.\nReason: The work is done.\nfiles_changed:\n- src/a.ts: fixed the parser\nvalidation:\n- npm test: 12 passed\nleft_undone:\n- none\n\nFirst answer.\n\nChild ${second.id} completed. Verdict: absent.\n\nSecond answer.`,
	);
	assert.deepEqual(ids(message), [first.id, second.id]);
});

test("one pending result goes out with its own details rather than a list", async () => {
	const delivery = recordingCore();
	const only = await delivery.launch();

	await finish(only, workerResult("blocked"), "Blocked answer.");
	delivery.core.atBoundary();

	const [{ details }] = delivery.sent;
	assert.equal(details.results, undefined);
	assert.deepEqual(
		{ id: details.id, state: details.state, verdict: details.verdict },
		{ id: only.id, state: "completed", verdict: "blocked" },
	);
	assert.deepEqual(details.result, workerResult("blocked"));
});

test("a consumed result is never sent and starts no message", async () => {
	const delivery = recordingCore();
	const read = await delivery.launch();
	const other = await delivery.launch();

	await finish(read, workerResult("blocked"));
	delivery.core.consume(read.id);
	delivery.core.atBoundary();
	assert.deepEqual(delivery.sent, []);

	await finish(other);
	delivery.core.atBoundary();
	delivery.core.atBoundary();
	assert.equal(delivery.sent.length, 1);
	assert.deepEqual(ids(delivery.sent[0]), [other.id]);
});

test("a failed send keeps the results pending, is reported, and is retried at the next boundary", async () => {
	const delivery = recordingCore({ failures: 1 });
	const only = await delivery.launch();
	await finish(only);

	delivery.core.atBoundary();
	assert.deepEqual(delivery.sent, []);
	assert.deepEqual(delivery.reports, [
		"Child results could not be delivered: transport closed",
	]);

	delivery.core.atBoundary();
	assert.equal(delivery.sent.length, 1);
	assert.deepEqual(ids(delivery.sent[0]), [only.id]);
	delivery.core.atBoundary();
	assert.equal(delivery.sent.length, 1);
});

test("a child question first delivers every pending result, whatever the wake rule says", async () => {
	const delivery = recordingCore();
	const quiet = await delivery.launch();
	const asker = await delivery.launch();
	await finish(quiet, workerResult("done"));

	void asker.child.spec.ask("Which file holds the parser?").catch(() => {});

	assert.deepEqual(
		delivery.sent.map((message) => message.customType),
		["pi-workflow-child-result", "pi-workflow-child-question"],
	);
	assert.deepEqual(ids(delivery.sent[0]), [quiet.id]);
	const question = delivery.sent[1];
	assert.equal(
		question.content,
		`Child ${asker.id} asks (question 1):\n\nWhich file holds the parser?\n\nAnswer with reply_child with question 1.`,
	);
	assert.equal(question.display, true);
	assert.deepEqual(
		{
			id: question.details.id,
			state: question.details.state,
			question: question.details.question,
			text: question.details.text,
		},
		{
			id: asker.id,
			state: "waiting",
			question: 1,
			text: "Which file holds the parser?",
		},
	);
});

test("a child question is still sent when delivering the pending results fails, and they stay pending", async () => {
	const delivery = recordingCore();
	const quiet = await delivery.launch();
	const asker = await delivery.launch();
	await finish(quiet);
	delivery.failNext();

	void asker.child.spec.ask("Which file?").catch(() => {});

	assert.deepEqual(
		delivery.sent.map((message) => message.customType),
		["pi-workflow-child-question"],
	);
	assert.deepEqual(delivery.reports, [
		"Child results could not be delivered: transport closed",
	]);
	asker.child.result.resolve("Answer.");
	await settle();
	delivery.core.atBoundary();
	assert.deepEqual(ids(delivery.sent.at(-1)), [quiet.id, asker.id]);
});

test("an idle parent receives results as soon as they end, with no boundary", async () => {
	const delivery = recordingCore({ idle: true });
	const first = await delivery.launch();
	const second = await delivery.launch();

	first.child.result.resolve("First.");
	second.child.result.resolve("Second.");
	await settle();

	assert.equal(delivery.sent.length, 1);
	assert.deepEqual(ids(delivery.sent[0]), [first.id, second.id]);
});

test("a busy parent receives nothing until the next boundary", async () => {
	const delivery = recordingCore();
	const only = await delivery.launch();

	await finish(only);
	assert.deepEqual(delivery.sent, []);
	delivery.core.atBoundary();

	assert.equal(delivery.sent.length, 1);
});

test("children queued or running when child session is unseated still start, finish, and deliver", async (t) => {
	const delivery = recordingCore();
	const launched = [];
	for (let i = 0; i < 6; i++) launched.push(await delivery.launch());
	assert.equal(delivery.core.get(launched[5].id).state, "queued");
	t.after(() =>
		replaceSelection({
			schemaVersion: 1,
			capabilities: Object.fromEntries(
				capabilities.map((name) => [name, true]),
			),
			expectations: {},
		}),
	);
	replaceSelection({
		schemaVersion: 1,
		capabilities: Object.fromEntries(capabilities.map((name) => [name, false])),
		expectations: {},
	});

	for (const launch of launched) await finish(launch);
	delivery.core.atBoundary();

	assert.equal(delivery.sent.length, 1);
	assert.deepEqual(
		ids(delivery.sent[0]),
		launched.map(({ id }) => id),
	);
});

test("ending the parent session drops the pending results", async () => {
	const delivery = recordingCore();
	const only = await delivery.launch();
	await finish(only);

	delivery.core.disposeAll();
	delivery.core.atBoundary();

	assert.deepEqual(delivery.sent, []);
});
