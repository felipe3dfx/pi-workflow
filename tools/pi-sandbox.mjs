#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ownedPiArguments = new Set([
	"-e",
	"--extension",
	"--session-dir",
	"--session",
	"--fork",
	"--export",
	"--skill",
	"--prompt-template",
	"--theme",
	"--mcp-config",
	"--approve",
	"-a",
	"--no-approve",
	"-na",
]);

export function parseSandboxArguments(arguments_) {
	let keep = false;
	let dryRun = false;
	const separator = arguments_.indexOf("--");
	const launcherArguments =
		separator === -1 ? arguments_ : arguments_.slice(0, separator);
	const piArguments = separator === -1 ? [] : arguments_.slice(separator + 1);
	for (const argument of launcherArguments) {
		if (argument === "--keep") keep = true;
		else if (argument === "--dry-run") dryRun = true;
		else if (argument === "--help" || argument === "-h")
			return { help: true, keep, dryRun, piArguments: [] };
		else
			throw new Error(
				`Unknown launcher argument: ${argument}. Put Pi arguments after --.`,
			);
	}
	if (
		piArguments.some((argument) =>
			ownedPiArguments.has(
				argument.includes("=")
					? argument.slice(0, argument.indexOf("="))
					: argument,
			),
		)
	) {
		throw new Error(
			"New resource, session, export, or trust controls are not allowed in the disposable launcher.",
		);
	}
	return { keep, dryRun, piArguments };
}

export function createSandboxPlan({
	root,
	sandboxRoot,
	piArguments,
	environment = process.env,
}) {
	const isolatedEnvironment = { ...environment };
	delete isolatedEnvironment.PI_PACKAGE_DIR;
	return {
		sandboxRoot,
		executable: join(root, "node_modules", ".bin", "pi"),
		arguments: ["-e", root, "--approve", ...piArguments],
		cwd: root,
		environment: {
			...isolatedEnvironment,
			HOME: join(sandboxRoot, "home"),
			PI_CODING_AGENT_DIR: join(sandboxRoot, "agent"),
			PI_CODING_AGENT_SESSION_DIR: join(sandboxRoot, "sessions"),
			PI_AGENT_HOME: join(sandboxRoot, "agent"),
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
			PI_TELEMETRY: "0",
		},
	};
}

async function assertPinnedLocalPi(root, executable) {
	const expected = JSON.parse(
		await readFile(join(root, "package.json"), "utf8"),
	).devDependencies?.["@earendil-works/pi-coding-agent"];
	const installed = JSON.parse(
		await readFile(
			join(
				root,
				"node_modules",
				"@earendil-works",
				"pi-coding-agent",
				"package.json",
			),
			"utf8",
		),
	).version;
	if (expected !== "0.80.6" || installed !== expected)
		throw new Error(
			`Disposable Pi requires the project-local pinned version 0.80.6; package=${expected ?? "missing"}, installed=${installed ?? "missing"}.`,
		);
	await access(executable);
}

function run(plan) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(plan.executable, plan.arguments, {
			cwd: plan.cwd,
			env: plan.environment,
			stdio: "inherit",
		});
		const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
		const forwardSignal = (signal) => {
			if (!child.killed) child.kill(signal);
		};
		for (const signal of signals) process.on(signal, forwardSignal);
		const settle = (callback) => {
			for (const signal of signals) process.off(signal, forwardSignal);
			callback();
		};
		child.once("error", (error) => settle(() => reject(error)));
		child.once("exit", (code, signal) =>
			settle(() => resolvePromise({ code: code ?? 1, signal })),
		);
	});
}

function help() {
	return `Launch project-local Pi with disposable config, packages, home, and sessions.\n\nUsage:\n  npm run pi:sandbox -- [--keep] [--dry-run] [--] [Pi arguments...]\n\nOptions:\n  --keep      Preserve the sandbox after Pi exits.\n  --dry-run   Print the launch plan without starting Pi.\n  --help      Show this help.\n\nAuthentication is isolated too. Export a provider API key, or use --keep and /login inside the sandbox.\n`;
}

export async function main(arguments_ = process.argv.slice(2)) {
	const parsed = parseSandboxArguments(arguments_);
	if (parsed.help) {
		process.stdout.write(help());
		return 0;
	}
	const sandboxRoot = await mkdtemp(join(tmpdir(), "pi-workflow-sandbox-"));
	const plan = createSandboxPlan({
		root: repositoryRoot,
		sandboxRoot,
		piArguments: parsed.piArguments,
	});
	try {
		await Promise.all([
			mkdir(plan.environment.HOME, { recursive: true }),
			mkdir(plan.environment.PI_CODING_AGENT_DIR, { recursive: true }),
			mkdir(plan.environment.PI_CODING_AGENT_SESSION_DIR, { recursive: true }),
		]);
		await assertPinnedLocalPi(repositoryRoot, plan.executable);
		if (parsed.dryRun) {
			process.stdout.write(
				`${JSON.stringify({ sandboxRoot, executable: plan.executable, arguments: plan.arguments, cwd: plan.cwd, isolation: { HOME: plan.environment.HOME, PI_CODING_AGENT_DIR: plan.environment.PI_CODING_AGENT_DIR, PI_CODING_AGENT_SESSION_DIR: plan.environment.PI_CODING_AGENT_SESSION_DIR, PI_AGENT_HOME: plan.environment.PI_AGENT_HOME, PI_OFFLINE: plan.environment.PI_OFFLINE, PI_TELEMETRY: plan.environment.PI_TELEMETRY } })}\n`,
			);
			return 0;
		}
		process.stderr.write(`Disposable Pi sandbox: ${sandboxRoot}\n`);
		const result = await run(plan);
		if (result.signal)
			process.stderr.write(
				`Disposable Pi exited after signal ${result.signal}.\n`,
			);
		return result.code;
	} finally {
		if (parsed.keep)
			process.stderr.write(`Preserved disposable Pi sandbox: ${sandboxRoot}\n`);
		else await rm(sandboxRoot, { recursive: true, force: true });
	}
}

const isMain =
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	main()
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			process.stderr.write(
				`Disposable Pi failed: ${error instanceof Error ? error.message : String(error)}\n`,
			);
			process.exitCode = 1;
		});
}
