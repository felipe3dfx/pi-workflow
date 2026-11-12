#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const largeResultBytes = 20 * 1024;
const childTools = new Set([
	"spawn_child",
	"continue_child",
	"reply_child",
	"child_result",
	"child_status",
	"list_children",
	"cancel_child",
]);
const metricLabels = {
	ownResultShare: "Own tool results, % of conversation bytes",
	largeCodemodeResults: "Codemode results over 20 KB, %",
	launchesWithReferences: "spawn_child launches with references, %",
	childMessageBytes: "Child message bytes delivered",
	explorationBudgetNotices: "Exploration budget notices",
};

function agentDirectory() {
	if (process.env.PI_CODING_AGENT_DIR) return resolve(process.env.PI_CODING_AGENT_DIR);
	if (process.env.PI_AGENT_HOME) return resolve(process.env.PI_AGENT_HOME);
	return resolve(process.env.HOME ?? homedir(), ".pi", "agent");
}

function jsonlFiles(root) {
	let directories;
	try {
		directories = readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	return directories
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) =>
			readdirSync(join(root, entry.name))
				.filter((name) => name.endsWith(".jsonl"))
				.map((name) => ({ group: entry.name, path: join(root, entry.name, name) })),
		);
}

function bytes(value) {
	return Buffer.byteLength(JSON.stringify(value ?? null));
}

function percent(part, whole) {
	return whole === 0 ? undefined : (100 * part) / whole;
}

function callsSpawnChild(call) {
	if (call.name === "spawn_child") return true;
	return call.name === "codemode" && /\bspawn_child\s*\(/.test(JSON.stringify(call.arguments));
}

function readSession(text, unparseable) {
	const session = {
		id: undefined,
		date: undefined,
		delegates: false,
		conversationBytes: 0,
		ownResultBytes: 0,
		codemodeResults: 0,
		largeCodemodeResults: 0,
		childMessageBytes: 0,
		explorationBudgetNotices: 0,
	};
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			unparseable.sessionLines += 1;
			continue;
		}
		if (entry.type === "session") {
			session.id = entry.id;
			session.date = String(entry.timestamp ?? "").slice(0, 10);
		} else if (entry.type === "custom_message") {
			const size = bytes(entry.content);
			session.conversationBytes += size;
			if (String(entry.customType).startsWith("pi-workflow-child")) session.childMessageBytes += size;
			if (entry.customType === "pi-workflow-exploration-budget") session.explorationBudgetNotices += 1;
		} else if (entry.type === "message" && entry.message?.role !== "system") {
			addMessage(session, entry.message ?? {});
		}
	}
	return session;
}

function addMessage(session, message) {
	const size = bytes(message.content);
	session.conversationBytes += size;
	if (message.role === "assistant" && Array.isArray(message.content)) {
		if (message.content.some((part) => part?.type === "toolCall" && callsSpawnChild(part))) {
			session.delegates = true;
		}
	} else if (message.role === "toolResult" && !childTools.has(message.toolName)) {
		session.ownResultBytes += size;
		if (message.toolName === "codemode") {
			session.codemodeResults += 1;
			if (size > largeResultBytes) session.largeCodemodeResults += 1;
		}
	}
}

function readLaunch(text) {
	let payload = "";
	for (const line of text.split("\n")) {
		const [, header, body] = line.split(/\t(.*?)\t(.*)/s);
		if (header === undefined) continue;
		const { ordinal, parts } = JSON.parse(header);
		if (ordinal !== 0) continue;
		payload += body;
		if (parts !== undefined) return JSON.parse(payload);
	}
	throw new Error("The child audit has no complete launch record.");
}

function readLaunches(root, unparseable) {
	const launches = new Map();
	for (const { group, path } of jsonlFiles(root)) {
		let launch;
		try {
			launch = readLaunch(readFileSync(path, "utf8"));
		} catch {
			unparseable.auditFiles += 1;
			continue;
		}
		if (launch.continuedFrom) continue;
		const counts = launches.get(group) ?? { launches: 0, withReferences: 0 };
		counts.launches += 1;
		if (Array.isArray(launch.references) && launch.references.length > 0) counts.withReferences += 1;
		launches.set(group, counts);
	}
	return launches;
}

function quantile(sorted, q) {
	const position = (sorted.length - 1) * q;
	const below = Math.floor(position);
	const above = Math.ceil(position);
	return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

function summarize(values, pooled) {
	const sorted = values.filter((value) => value !== undefined).sort((a, b) => a - b);
	if (sorted.length === 0) return { n: 0, median: null, p90: null, pooled: null };
	return { n: sorted.length, median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), pooled };
}

function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}

function ratio(pairs) {
	const present = pairs.filter((pair) => pair !== undefined);
	return summarize(
		present.map(([part, whole]) => percent(part, whole)),
		percent(sum(present.map(([part]) => part)), sum(present.map(([, whole]) => whole))),
	);
}

function count(values) {
	return summarize(values, sum(values));
}

function measure({ sessions: sessionRoot, audit, since, until }) {
	const unparseable = { sessionFiles: 0, sessionLines: 0, auditFiles: 0 };
	const launches = readLaunches(audit, unparseable);
	const sessions = [];
	for (const { path } of jsonlFiles(sessionRoot)) {
		const session = readSession(readFileSync(path, "utf8"), unparseable);
		if (!session.id || !session.date) {
			unparseable.sessionFiles += 1;
			continue;
		}
		if (!session.delegates) continue;
		if ((since && session.date < since) || (until && session.date > until)) continue;
		sessions.push(session);
	}
	const metrics = {
		ownResultShare: ratio(sessions.map((s) => [s.ownResultBytes, s.conversationBytes])),
		largeCodemodeResults: ratio(sessions.map((s) => [s.largeCodemodeResults, s.codemodeResults])),
		launchesWithReferences: ratio(
			sessions.map((s) => {
				const counts = launches.get(s.id);
				return counts && [counts.withReferences, counts.launches];
			}),
		),
		childMessageBytes: count(sessions.map((s) => s.childMessageBytes)),
		explorationBudgetNotices: count(sessions.map((s) => s.explorationBudgetNotices)),
	};
	return { sessions: sessions.length, since: since ?? null, until: until ?? null, metrics, unparseable };
}

function formatNumber(value) {
	if (value === null) return "-";
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function markdown(report) {
	const rows = Object.entries(report.metrics).map(
		([key, { n, median, p90, pooled }]) =>
			`| ${metricLabels[key]} | ${n} | ${formatNumber(median)} | ${formatNumber(p90)} | ${formatNumber(pooled)} |`,
	);
	const { sessionFiles, sessionLines, auditFiles } = report.unparseable;
	return [
		`Delegating parent sessions: ${report.sessions} (since ${report.since ?? "start"}, until ${report.until ?? "now"})`,
		"",
		"| Metric | n | Median | p90 | Pooled or total |",
		"| --- | --- | --- | --- | --- |",
		...rows,
		"",
		`Unparseable: ${sessionFiles} session files, ${sessionLines} session lines, ${auditFiles} audit files.`,
		"",
	].join("\n");
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const { values } = parseArgs({
	options: {
		since: { type: "string" },
		until: { type: "string" },
		json: { type: "boolean", default: false },
		sessions: { type: "string" },
		audit: { type: "string" },
	},
});
for (const name of ["since", "until"]) {
	if (values[name] !== undefined && !datePattern.test(values[name])) {
		console.error(`--${name} must be a date in YYYY-MM-DD form.`);
		process.exit(2);
	}
}
const report = measure({
	sessions: resolve(values.sessions ?? join(agentDirectory(), "sessions")),
	audit: resolve(values.audit ?? join(agentDirectory(), "pi-workflow-audit")),
	since: values.since,
	until: values.until,
});
process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : markdown(report));
