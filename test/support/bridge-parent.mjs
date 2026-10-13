import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export async function createBridgeParentSession({
	cwd,
	agentDir,
	extensionPath,
	model,
	nativeProvider,
	runtime: existingRuntime,
}) {
	const runtime = existingRuntime ?? await ModelRuntime.create({
		authPath: `${agentDir}/auth.json`,
		modelsPath: null,
		refreshOnCreate: false,
	});
	if (nativeProvider) runtime.registerNativeProvider(nativeProvider);
	const settings = SettingsManager.inMemory({}, { projectTrusted: false });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: settings,
		noExtensions: true,
		additionalExtensionPaths: [extensionPath],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		modelRuntime: runtime,
		model,
		resourceLoader: loader,
		settingsManager: settings,
		sessionManager: SessionManager.inMemory(cwd),
	});
	return { session, runtime, loader };
}
