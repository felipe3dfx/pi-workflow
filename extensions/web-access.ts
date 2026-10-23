import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
	DefaultPackageManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { errorMessage } from "./error-message.ts";

export interface ParentProject {
	cwd: string;
	trusted: boolean;
}

const webAccessPackage = "pi-web-access";
const webAccessSource = `npm:${webAccessPackage}`;
const claudeBridgePackage = "pi-claude-bridge";
const claudeBridgeRepository = "github.com/elidickinson/pi-claude-bridge";

export const webAccessTools = [
	"web_search",
	"source_check",
	"fetch_content",
	"get_search_content",
];

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

export function resolveWebAccessExtensions(
	agentDir: string,
	project: ParentProject,
): string[] {
	const directory = webAccessDirectory(agentDir, project);
	if (directory === undefined) {
		throw new Error(`${webAccessPackage} is not installed locally, so the explorer has no web tools.`);
	}
	const paths = entries(directory);
	if (paths.length === 0) {
		throw new Error(`${webAccessPackage} could not be loaded, so the explorer has no web tools: ${directory} declares no extension.`);
	}
	return paths;
}

function repositoryIdentity(value: unknown): string | undefined {
	const input = typeof value === "object" && value !== null
		? (value as { url?: unknown }).url
		: value;
	if (typeof input !== "string" || input.length === 0) return undefined;
	let url = input.replace(/^git\+/, "");
	const scp = /^git@([^:]+):(.+)$/.exec(url);
	if (scp) url = `https://${scp[1]}/${scp[2]}`;
	if (url.startsWith("git://")) url = `https://${url.slice("git://".length)}`;
	if (!/^[a-z][a-z\d+.-]*:\/\//i.test(url)) {
		url = `https://${url.replace(/@[^/@]+$/, "")}`;
	}
	try {
		const parsed = new URL(url);
		let path = parsed.pathname.replace(/^\/+|\/+$/g, "");
		const officialPath = `elidickinson/${claudeBridgePackage}`;
		const officialIndex = path.indexOf(officialPath);
		if (officialIndex >= 0) {
			const suffix = path.slice(officialIndex + officialPath.length);
			if (suffix === "" || suffix.startsWith("@") || /^\.git(?:@.*)?$/i.test(suffix)) {
				path = path.slice(0, officialIndex + officialPath.length);
			}
		}
		path = path.replace(/\.git$/i, "");
		return `${parsed.hostname.toLowerCase()}/${path}`.toLowerCase();
	} catch {
		return undefined;
	}
}

function officialBridgeSourceIdentity(source: string): string | false | undefined {
	if (source.startsWith("npm:")) {
		const name = source.slice("npm:".length).split("@")[0];
		return name === claudeBridgePackage ? `npm:${name}` : false;
	}
	if (source.startsWith("git:")) {
		const identity = repositoryIdentity(source.slice("git:".length));
		return identity === claudeBridgeRepository ? `git:${identity}` : false;
	}
	return undefined;
}

function bridgeSourceIdentity(source: string, manifest: Record<string, unknown>) {
	const officialManifest =
		manifest.name === claudeBridgePackage &&
		repositoryIdentity(manifest.repository) === claudeBridgeRepository;
	const sourceIdentity = officialBridgeSourceIdentity(source);
	if (sourceIdentity === false) return false;
	if (sourceIdentity !== undefined && !officialManifest) {
		throw new Error(`Configured ${source} does not identify the official Claude Bridge package.`);
	}
	return officialManifest;
}

function effectiveConfiguredBridgePackages(manager: DefaultPackageManager, project: ParentProject, agentDir: string) {
	const projectSettings = SettingsManager.create(project.cwd, agentDir, {
		projectTrusted: project.trusted,
	}).getProjectSettings();
	const autoloadDisabledProjectSources = new Set(
		(projectSettings.packages ?? []).flatMap((pkg) =>
			typeof pkg === "object" && pkg.autoload === false
				? [officialBridgeSourceIdentity(pkg.source) ?? pkg.source]
				: [],
		),
	);
	const configured = manager.listConfiguredPackages().flatMap((pkg) => {
		if (pkg.scope === "project" && !project.trusted) return [];
		const sourceIdentity = officialBridgeSourceIdentity(pkg.source);
		if (sourceIdentity === false) return [];
		const identity = sourceIdentity ?? (pkg.installedPath
			? `local:${realpathSync(pkg.installedPath)}`
			: undefined);
		return identity === undefined ? [] : [{ ...pkg, identity, sourceIdentity }];
	});
	const userIdentities = new Set(
		configured.filter(({ scope }) => scope === "user").map(({ identity }) => identity),
	);
	const projectIdentities = new Set(
		configured.filter(({ scope, source }) =>
			scope === "project" && !autoloadDisabledProjectSources.has(
				officialBridgeSourceIdentity(source) ?? source,
			),
		).map(({ identity }) => identity),
	);
	const selected = configured.filter(({ scope, source, identity }) => {
		if (scope !== "project") return !projectIdentities.has(identity);
		const isDisabledUserTemplate = autoloadDisabledProjectSources.has(
			officialBridgeSourceIdentity(source) ?? source,
		) && userIdentities.has(identity);
		return !isDisabledUserTemplate;
	});
	const unique = new Map<string, (typeof selected)[number]>();
	for (const pkg of selected) {
		const root = pkg.installedPath ? realpathSync(pkg.installedPath) : "";
		const key = `${pkg.identity}\0${pkg.scope}\0${root}`;
		if (!unique.has(key)) unique.set(key, pkg);
	}
	return [...unique.values()];
}

function packageManifest(path: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
	} catch (error) {
		throw new Error(`Unable to read the configured Claude Bridge package manifest at ${path}: ${errorMessage(error)}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`The configured Claude Bridge package manifest at ${path} must contain a JSON object.`);
	}
	return parsed as Record<string, unknown>;
}

function inside(root: string, path: string) {
	const rel = relative(root, path);
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function resolveClaudeBridgeExtension(
	agentDir: string,
	project: ParentProject,
): Promise<string> {
	const manager = packageManager(agentDir, project);
	const effective = effectiveConfiguredBridgePackages(manager, project, agentDir);
	let resolved: Awaited<ReturnType<typeof manager.resolve>>;
	try {
		resolved = await manager.resolve(async () => "skip");
	} catch (error) {
		throw new Error(`Unable to resolve the configured Claude Bridge package: ${errorMessage(error)}`);
	}
	const officialCandidatesBySource = new Map<string, (typeof resolved.extensions)[number]>();
	for (const resource of resolved.extensions) {
		const packageRoot = resource.metadata.packageRoot ?? resource.metadata.baseDir;
		if (!packageRoot) continue;
		const sourceIdentity = officialBridgeSourceIdentity(resource.metadata.source);
		if (sourceIdentity === false) continue;
		const root = realpathSync(packageRoot);
		const identity = sourceIdentity ?? `local:${root}`;
		// Local index.ts packages need not have a manifest. Only inspect installed candidates.
		if (sourceIdentity === undefined && !existsSync(join(packageRoot, "package.json"))) continue;
		const manifest = packageManifest(packageRoot);
		if (!bridgeSourceIdentity(resource.metadata.source, manifest)) continue;
		const key = `${identity}\0${resource.metadata.scope}\0${root}`;
		if (!officialCandidatesBySource.has(key)) officialCandidatesBySource.set(key, resource);
	}
	const officialCandidates = [...officialCandidatesBySource.values()];
	const enabled = officialCandidates.filter((resource) => resource.enabled);
	if (enabled.length !== 1) {
		if (enabled.length === 0 && officialCandidates.length === 0) {
			const installedEffective = effective.filter(({ installedPath }) => installedPath !== undefined);
			if (installedEffective.length === 0) {
				throw new Error(
					`Claude Bridge was selected, but the official ${claudeBridgePackage} package is not installed and configured for the parent project or user scope.`,
				);
			}
			for (const pkg of installedEffective) {
				if (pkg.installedPath) packageManifest(pkg.installedPath);
			}
		}
		const state = enabled.length === 0
			? officialCandidates.length > 0 ? "filtered out or disabled" : "missing, filtered out, or disabled"
			: "ambiguous";
		throw new Error(`The official Claude Bridge extension resource is ${state} in the parent project's Pi configuration.`);
	}

	const selected = enabled[0];
	const packageRoot = selected.metadata.packageRoot ?? selected.metadata.baseDir;
	if (!packageRoot) {
		throw new Error("The resolved Claude Bridge resource has no installed package root.");
	}
	let root: string;
	let extension: string;
	try {
		root = realpathSync(packageRoot);
		extension = realpathSync(selected.path);
	} catch (error) {
		throw new Error(`The configured Claude Bridge extension is unreadable: ${errorMessage(error)}`);
	}
	if (!inside(root, extension) || !statSync(extension).isFile()) {
		throw new Error("The configured Claude Bridge extension is not a regular resource inside its installed package.");
	}
	const manifest = packageManifest(root);
	if (!bridgeSourceIdentity(selected.metadata.source, manifest)) {
		throw new Error("The resolved extension does not match the official Claude Bridge package identity.");
	}
	const declared = (manifest.pi as { extensions?: unknown } | undefined)?.extensions;
	if (!Array.isArray(declared) || declared.length !== 1 || typeof declared[0] !== "string") {
		throw new Error("The official Claude Bridge manifest must declare exactly one extension resource.");
	}
	const declaredPath = resolve(root, declared[0]);
	let realDeclaredPath: string;
	try {
		realDeclaredPath = realpathSync(declaredPath);
	} catch (error) {
		throw new Error(`The official Claude Bridge extension resource is unreadable: ${errorMessage(error)}`);
	}
	if (!inside(root, realDeclaredPath) || realDeclaredPath !== extension) {
		throw new Error("The resolved resource does not match the official package's declared extension.");
	}
	return extension;
}

export async function inspectClaudeBridgeCompanion(
	agentDir: string,
	project: ParentProject,
): Promise<{ version?: string; error?: string }> {
	try {
		const manager = packageManager(agentDir, project);
		await manager.resolve(async () => "skip");
		const effective = effectiveConfiguredBridgePackages(manager, project, agentDir);
		const official = effective.flatMap((pkg) => {
			const installedPath = pkg.installedPath;
			if (!installedPath) return [];
			if (pkg.sourceIdentity === undefined && !existsSync(join(installedPath, "package.json"))) return [];
			const manifest = packageManifest(installedPath);
			if (!bridgeSourceIdentity(pkg.source, manifest)) return [];
			if (typeof manifest.version !== "string" || manifest.version.length === 0) {
				throw new Error("The official Claude Bridge manifest does not define a package version.");
			}
			return [{ identity: pkg.identity, scope: pkg.scope, version: manifest.version }];
		});
		if (official.length === 0) return {};
		if (official.length !== 1) {
			return { error: "The official Claude Bridge package is configured from multiple effective sources." };
		}
		return { version: official[0].version };
	} catch (error) {
		return { error: errorMessage(error) };
	}
}
