import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createChildBashTool } from "../extensions/child-bash.ts";
import { withAgentDirectory } from "./support/jev-routing.mjs";

function run(command) {
	const dir = process.cwd();
	return createChildBashTool(dir).execute(
		"call-1",
		{ command },
		undefined,
		undefined,
		undefined,
	);
}

function text(result) {
	return result.content.map((part) => part.text).join("");
}

test("while Jev routing is off, a child's bash refuses a command that runs git", async (t) => {
	withAgentDirectory(t);

	await assert.rejects(run("git status"), (error) => {
		assert.match(error.message, /\bgit\b/);
		assert.match(error.message, /blocked/);
		assert.match(error.message, /ask_parent/);
		return true;
	});
});

test("while Jev routing is off, a child's bash refuses git and gh wherever the shell would run them", async (t) => {
	withAgentDirectory(t);

	for (const [command, program] of [
		["gh pr view", "gh"],
		["  git\tstatus", "git"],
		["cd repo && git log", "git"],
		["true || gh pr list", "gh"],
		["echo a; git status", "git"],
		["echo a | git apply", "git"],
		["echo a |& git apply", "git"],
		["echo a\ngit status", "git"],
		["sleep 0 & git status", "git"],
		["(git status)", "git"],
		["{ git status; }", "git"],
		["echo $(git rev-parse HEAD)", "git"],
		['echo "branch: $(gh pr view)"', "gh"],
		["echo `git log`", "git"],
		["diff <(git show HEAD:a) a", "git"],
		["env GIT_DIR=x git status", "git"],
		["env -i git status", "git"],
		["command git status", "git"],
		["sudo -u root git status", "git"],
		["FOO=1 git status", "git"],
		["nohup git fetch", "git"],
		["time git status", "git"],
		["timeout 5 gh pr list", "gh"],
		["ls | xargs git add", "git"],
		["/usr/bin/git status", "git"],
		["~/bin/gh pr list", "gh"],
		["'git' status", "git"],
		['"gh" pr view', "gh"],
		["g\\it status", "git"],
		["g'i't status", "git"],
		["if git diff --quiet; then echo same; fi", "git"],
		["while gh run list; do :; done", "gh"],
		["! git diff --quiet", "git"],
		["bash -c 'git status'", "git"],
		['sh -lc "cd x && gh pr view"', "gh"],
		["eval git status", "git"],
		["find . -name a -exec git add {} \\;", "git"],
		["2>/dev/null git status", "git"],
		["nice -n 5 time -p git status", "git"],
		["timeout -s KILL 5 git status", "git"],
		["ls | xargs -I {} git add {}", "git"],
		["ls | xargs -n1 gh issue view", "gh"],
		["sudo -u root -- git status", "git"],
		["env -u FOO -C repo git status", "git"],
		["find . -exec env git add {} \\;", "git"],
	]) {
		await assert.rejects(
			run(command),
			(error) => {
				assert.match(error.message, new RegExp(`runs ${program}\\b`));
				return true;
			},
			command,
		);
	}
});

test("while Jev routing is off, a child's bash refuses a command it cannot read with confidence", async (t) => {
	withAgentDirectory(t);

	for (const command of [
		"echo 'unterminated",
		'echo "unterminated',
		"$CMD status",
		'"$TOOL" status',
		"echo $(git status",
		"(git status",
		"echo a )",
		"case x in git) ;; esac",
		"f() { git status; }",
		"gi* status",
		`echo \${x:-$(git status)}`,
		"cat <<EOF\n$(git status)\nEOF",
		"echo git | bash",
		"env -S 'git status'",
		"sudo --bogus git status",
		"xargs -Z git add",
	]) {
		await assert.rejects(
			run(command),
			(error) => {
				assert.match(error.message, /git or gh/);
				assert.match(error.message, /blocked/);
				assert.match(error.message, /ask_parent/);
				return true;
			},
			command,
		);
	}
});

test("while Jev routing is off, a child's bash runs a command that only mentions git or gh", async (t) => {
	withAgentDirectory(t);

	for (const [command, output] of [
		["printf '%s\\n' git", "git"],
		["echo gh", "gh"],
		["echo 'git status'", "git status"],
		["echo .git/config gitignore github", ".git/config gitignore github"],
		["echo git 2>&1 | grep git", "git"],
		["for word in git gh; do echo $word; done", "git\ngh"],
		["printf '%s' \"$(echo git)\"", "git"],
		["cat <<'EOF'\ngit status\nEOF", "git status"],
		["cat <<-EOF\n\tgh pr view\n\tEOF", "gh pr view"],
		["# git status\necho done", "done"],
		["test -n git && echo yes", "yes"],
		["[[ git == git ]] && echo same", "same"],
		["env FOO=git printenv FOO", "git"],
		["nice grep -o git README.md | head -n1", "git"],
		["timeout 5 grep -o git README.md | head -n1", "git"],
		["echo README.md | xargs grep -o git | head -n1", "git"],
		["env FOO=1 grep -o gh README.md | head -n1", "gh"],
	]) {
		assert.equal(text(await run(command)).trim(), output, command);
	}
});

test("while Jev routing is off, a child's bash runs a timed command that only mentions git", async (t) => {
	withAgentDirectory(t);

	assert.match(text(await run("time grep -c git README.md")), /^\d+/);
});

test("while Jev routing is on, a child's bash runs git", async (t) => {
	const dir = withAgentDirectory(t);
	writeFileSync(
		join(dir, "pi-workflow-routing.json"),
		JSON.stringify({ schemaVersion: 1, jevRouting: "on" }),
	);

	assert.match(text(await run("git --version")), /^git version/);
});
