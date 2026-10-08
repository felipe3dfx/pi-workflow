import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import * as piAi from "@earendil-works/pi-ai/compat";
import * as piCodingAgent from "@earendil-works/pi-coding-agent";
import {
	DefaultPackageManager,
	type ExtensionFactory,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import * as piTui from "@earendil-works/pi-tui";
import { createJiti } from "jiti";
import * as typebox from "typebox";
import * as typeboxValue from "typebox/value";

import { errorMessage } from "./error-message.ts";

export interface ParentProject {
	cwd: string;
	trusted: boolean;
}

const webAccessPackage = "pi-web-access";
const webAccessSource = `npm:${webAccessPackage}`;

export const webAccessTools = [
	"web_search",
	"source_check",
	"fetch_content",
	"get_search_content",
];

// The specifiers Pi's extension loader maps to its own modules, limited to the harness's peers.
// Re-verify against Pi's loader on every Pi upgrade.
const hostModules = {
	"@earendil-works/pi-coding-agent": piCodingAgent,
	"@earendil-works/pi-ai": piAi,
	"@earendil-works/pi-ai/compat": piAi,
	"@earendil-works/pi-tui": piTui,
	typebox,
	"typebox/value": typeboxValue,
};

function moduleFile(path: string): string | undefined {
	if (!existsSync(path)) return undefined;
	if (!statSync(path).isDirectory()) return path;
	return ["index.ts", "index.js"]
		.map((name) => join(path, name))
		.find((file) => existsSync(file));
}

function entries(directory: string): string[] {
	const manifest = join(directory, "package.json");
	if (existsSync(manifest)) {
		const declared = (
			JSON.parse(readFileSync(manifest, "utf8")) as {
				pi?: { extensions?: unknown };
			}
		).pi?.extensions;
		if (Array.isArray(declared)) {
			const paths = declared
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => moduleFile(resolve(directory, entry)))
				.filter((path): path is string => path !== undefined);
			if (paths.length > 0) return paths;
		}
	}
	const index = moduleFile(directory);
	return index === undefined ? [] : [index];
}

// Each call evaluates the package again, so no explorer shares module state with the
// parent's instance or another explorer's. jiti.import would load an ES module package
// natively, through Node's shared module cache and without the host modules.
async function loadWebAccess(
	directory: string,
): Promise<ExtensionFactory[]> {
	const paths = entries(directory);
	if (paths.length === 0) {
		throw new Error(`${directory} declares no extension.`);
	}
	const jiti = createJiti(import.meta.url, {
		moduleCache: false,
		tryNative: false,
		virtualModules: hostModules,
	});
	const factories: ExtensionFactory[] = [];
	for (const path of paths) {
		const loaded = (await jiti.evalModule(readFileSync(path, "utf8"), {
			filename: path,
			async: true,
			forceTranspile: true,
		})) as { default?: unknown } | undefined;
		const factory = loaded?.default ?? loaded;
		if (typeof factory !== "function") {
			throw new Error(`${path} does not export an extension factory.`);
		}
		factories.push(factory as ExtensionFactory);
	}
	return factories;
}

function packageManager(agentDir: string, project: ParentProject) {
	return new DefaultPackageManager({
		cwd: project.cwd,
		agentDir,
		settingsManager: SettingsManager.create(project.cwd, agentDir, {
			projectTrusted: project.trusted,
		}),
	});
}

// A reused package manager keeps the global root it resolves, so npm and bun resolve it once per
// agent directory; under pnpm, every user-scope lookup that misses runs `pnpm list -g`.
const userPackages = new Map<string, DefaultPackageManager>();

function webAccessDirectory(agentDir: string, project: ParentProject) {
	const local = project.trusted
		? packageManager(agentDir, project).getInstalledPath(
				webAccessSource,
				"project",
			)
		: undefined;
	if (local) return local;
	let user = userPackages.get(agentDir);
	if (!user) {
		user = packageManager(agentDir, project);
		userPackages.set(agentDir, user);
	}
	return user.getInstalledPath(webAccessSource, "user");
}

export async function explorerWeb(agentDir: string, project: ParentProject) {
	const directory = webAccessDirectory(agentDir, project);
	if (directory === undefined) {
		return {
			factories: [],
			problem: `${webAccessPackage} is not installed locally, so the explorer has no web tools.`,
		};
	}
	try {
		return { factories: await loadWebAccess(directory), problem: undefined };
	} catch (error) {
		return {
			factories: [],
			problem: `${webAccessPackage} could not be loaded, so the explorer has no web tools: ${errorMessage(error)}`,
		};
	}
}
