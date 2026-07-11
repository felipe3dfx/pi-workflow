import { execFile } from "node:child_process";

export function runPackedSubprocess(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		execFile(command, args, options, (error, stdout, stderr) => {
			if (!error) {
				resolve({ stdout, stderr });
				return;
			}
			const timeoutDetail = error.killed
				? `timed out after ${options.timeout}ms (${error.signal ?? "terminated"})`
				: error.message;
			const failure = new Error(
				`${command} ${args.join(" ")} failed: ${timeoutDetail}\nstderr:\n${stderr || "<empty>"}`,
				{ cause: error },
			);
			failure.code = error.code;
			failure.stdout = stdout;
			failure.stderr = stderr;
			reject(failure);
		});
	});
}
