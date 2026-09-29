export function gitEnvironment(): NodeJS.ProcessEnv {
	const { GIT_DIR: _dir, GIT_WORK_TREE: _workTree, ...env } = process.env;
	return env;
}
