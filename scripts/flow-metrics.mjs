#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { resolveAgentDirectory } from "../extensions/agent-directory.ts";

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
	largeCodemodeResults: "Codemode results over 20 KiB, %",
	launchesWithReferences: "spawn_child launches with references, %",
	childMessageBytes: "Child message bytes delivered",
	explorationBudgetNotices: "Exploration budget notices",
};
const usage = `Usage: node scripts/flow-metrics.mjs [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json] [--sessions DIR] [--audit DIR]

Reports flow metrics for delegating parent sessions. --since and --until are inclusive
and compare against the UTC date of each session's start.
`;

function jsonlFiles(root, name) {
	let directories;
	try {
		directories = readdirSync(root, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error(`${name} directory not found: ${root}`);
		throw error;
	}
	const files = [];
	let unreadable = 0;
	for (const entry of directories.filter((entry) => entry.isDirectory())) {
		try {
			for (const file of readdirSync(join(root, entry.name))) {
				if (file.endsWith(".jsonl")) files.push({ group: entry.name, path: join(root, entry.name, file) });
			}
		} catch {
			unreadable += 1;
		}
	}
	return { files, unreadable };
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

function readSession(text) {
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
		unparseableLines: 0,
	};
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			session.unparseableLines += 1;
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
	} else if (message.role === "toolResult" && message.toolName === "child_result") {
		session.childMessageBytes += size;
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

function readLaunches(root) {
	const launches = new Map();
	const { files, unreadable } = jsonlFiles(root, "Audit");
	let unparseableFiles = unreadable;
	for (const { group, path } of files) {
		let launch;
		try {
			launch = readLaunch(readFileSync(path, "utf8"));
		} catch {
			unparseableFiles += 1;
			continue;
		}
		if (launch.continuedFrom) continue;
		const counts = launches.get(group) ?? { launches: 0, withReferences: 0 };
		counts.launches += 1;
		if (Array.isArray(launch.references) && launch.references.length > 0) counts.withReferences += 1;
		launches.set(group, counts);
	}
	return { launches, unparseableFiles };
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

function total(values) {
	return values.reduce((total, value) => total + value, 0);
}

function ratio(pairs) {
	const present = pairs.filter((pair) => pair !== undefined);
	return summarize(
		present.map(([part, whole]) => percent(part, whole)),
		percent(total(present.map(([part]) => part)), total(present.map(([, whole]) => whole))),
	);
}

function summarizeWithTotal(values) {
	return summarize(values, total(values));
}

function measure({ sessions: sessionRoot, audit, since, until }) {
	const sessionFiles = jsonlFiles(sessionRoot, "Sessions");
	const { launches, unparseableFiles: unparseableAuditFiles } = readLaunches(audit);
	let unparseableSessionFiles = sessionFiles.unreadable;
	let unparseableSessionLines = 0;
	const sessionIds = new Set();
	const sessions = [];
	for (const { path } of sessionFiles.files) {
		let text;
		try {
			text = readFileSync(path, "utf8");
		} catch {
			unparseableSessionFiles += 1;
			continue;
		}
		const session = readSession(text);
		unparseableSessionLines += session.unparseableLines;
		if (!session.id || !session.date) {
			unparseableSessionFiles += 1;
			continue;
		}
		sessionIds.add(session.id);
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
		childMessageBytes: summarizeWithTotal(sessions.map((s) => s.childMessageBytes)),
		explorationBudgetNotices: summarizeWithTotal(sessions.map((s) => s.explorationBudgetNotices)),
	};
	return {
		sessions: sessions.length,
		since: since ?? null,
		until: until ?? null,
		metrics,
		delegatingSessionsWithoutAudit: sessions.filter((s) => !launches.has(s.id)).length,
		allFiles: {
			auditGroupsWithoutSession: [...launches.keys()].filter((id) => !sessionIds.has(id)).length,
			unparseableSessionFiles,
			unparseableSessionLines,
			unparseableAuditFiles,
		},
	};
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
	const { auditGroupsWithoutSession, unparseableSessionFiles, unparseableSessionLines, unparseableAuditFiles } =
		report.allFiles;
	return [
		`Delegating parent sessions: ${report.sessions} (since ${report.since ?? "start"}, until ${report.until ?? "now"})`,
		"",
		"| Metric | n | Median | p90 | Pooled or total |",
		"| --- | --- | --- | --- | --- |",
		...rows,
		"",
		`Delegating sessions without audit records: ${report.delegatingSessionsWithoutAudit}.`,
		`All files, not date-filtered: ${auditGroupsWithoutSession} audit groups without a parent session; unparseable ${unparseableSessionFiles} session files, ${unparseableSessionLines} session lines, ${unparseableAuditFiles} audit files.`,
		"",
	].join("\n");
}

function isRealDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function main() {
	const { values } = parseArgs({
		options: {
			since: { type: "string" },
			until: { type: "string" },
			json: { type: "boolean", default: false },
			sessions: { type: "string" },
			audit: { type: "string" },
			help: { type: "boolean", default: false },
		},
	});
	if (values.help) {
		process.stdout.write(usage);
		return;
	}
	for (const name of ["since", "until"]) {
		if (values[name] !== undefined && !isRealDate(values[name])) {
			throw new Error(`--${name} must be a real date in YYYY-MM-DD form.`);
		}
	}
	if (values.since && values.until && values.since > values.until) {
		throw new Error("--since must not be after --until.");
	}
	const agentDirectory = resolveAgentDirectory();
	const report = measure({
		sessions: resolve(values.sessions ?? join(agentDirectory, "sessions")),
		audit: resolve(values.audit ?? join(agentDirectory, "pi-workflow-audit")),
		since: values.since,
		until: values.until,
	});
	process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : markdown(report));
}

try {
	main();
} catch (error) {
	process.stderr.write(`${error.message}\n`);
	process.exitCode = 1;
}
