import {
	createBashToolDefinition,
	defineTool,
} from "@earendil-works/pi-coding-agent";

import { jevRoutingEnabled } from "./workflow-settings.ts";

type Word = { text: string; quoted: boolean; dynamic: boolean };

const unreadable = new Error("unreadable command");

function fail(): never {
	throw unreadable;
}

const keywords = new Set([
	"!",
	"{",
	"if",
	"then",
	"else",
	"elif",
	"do",
	"while",
	"until",
]);

const unsupported = new Set(["case", "coproc", "function", "select"]);

type Wrapper = { flags: string[]; values: string[]; operands?: number };

const wrappers = new Map<string, Wrapper>([
	["builtin", { flags: [], values: [] }],
	["command", { flags: ["-p", "-v", "-V"], values: [] }],
	["doas", { flags: ["-n", "-s"], values: ["-u", "-C"] }],
	[
		"env",
		{
			flags: ["-i", "-0", "-v", "--ignore-environment", "--null", "--debug"],
			values: ["-u", "-C", "--unset", "--chdir"],
		},
	],
	["exec", { flags: ["-c", "-l"], values: ["-a"] }],
	[
		"ionice",
		{
			flags: ["-t", "--ignore"],
			values: ["-c", "-n", "--class", "--classdata"],
		},
	],
	["nice", { flags: [], values: ["-n", "--adjustment"] }],
	["nohup", { flags: [], values: [] }],
	[
		"setsid",
		{ flags: ["-c", "-f", "-w", "--ctty", "--fork", "--wait"], values: [] },
	],
	[
		"stdbuf",
		{ flags: [], values: ["-i", "-o", "-e", "--input", "--output", "--error"] },
	],
	[
		"sudo",
		{
			flags: [
				"-A",
				"-b",
				"-E",
				"-H",
				"-n",
				"-P",
				"-S",
				"-s",
				"-i",
				"-k",
				"--askpass",
				"--background",
				"--preserve-env",
				"--set-home",
				"--non-interactive",
				"--preserve-groups",
				"--stdin",
				"--shell",
				"--login",
				"--reset-timestamp",
			],
			values: [
				"-C",
				"-D",
				"-g",
				"-h",
				"-p",
				"-R",
				"-r",
				"-T",
				"-t",
				"-U",
				"-u",
				"--close-from",
				"--chdir",
				"--group",
				"--host",
				"--prompt",
				"--chroot",
				"--role",
				"--command-timeout",
				"--type",
				"--other-user",
				"--user",
			],
		},
	],
	[
		"time",
		{
			flags: [
				"-p",
				"-a",
				"-v",
				"-q",
				"--portability",
				"--append",
				"--verbose",
				"--quiet",
			],
			values: ["-f", "-o", "--format", "--output"],
		},
	],
	[
		"timeout",
		{
			flags: ["-v", "--verbose", "--preserve-status", "--foreground"],
			values: ["-s", "-k", "--signal", "--kill-after"],
			operands: 1,
		},
	],
	[
		"xargs",
		{
			flags: [
				"-0",
				"-r",
				"-t",
				"-p",
				"-x",
				"-o",
				"--null",
				"--no-run-if-empty",
				"--verbose",
				"--interactive",
				"--exit",
				"--open-tty",
			],
			values: [
				"-a",
				"-d",
				"-E",
				"-I",
				"-L",
				"-n",
				"-P",
				"-s",
				"--arg-file",
				"--delimiter",
				"--max-lines",
				"--max-args",
				"--max-procs",
				"--max-chars",
				"--process-slot-var",
			],
		},
	],
]);

const shells = new Set(["sh", "bash", "dash", "ksh", "zsh", "fish"]);

const findActions = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

const redirection = /^(?:<<<|<<-|<<|&>>|&>|>>|>&|<&|<>|>\||<|>)/;

const separator = /^(?:&&|\|\||;;&|;;|;&|\|&|[;&|])/;

function parse(source: string): Word[][] {
	const commands: Word[][] = [];
	const heredocs: { delimiter: string; quoted: boolean; tabs: boolean }[] = [];
	let pos = 0;

	function readHeredocs() {
		for (const { delimiter, quoted, tabs } of heredocs.splice(0)) {
			for (;;) {
				if (pos >= source.length) fail();
				const end = source.indexOf("\n", pos);
				const line = source.slice(pos, end === -1 ? source.length : end);
				pos = end === -1 ? source.length : end + 1;
				if ((tabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
				if (!quoted && /\$\(|`/.test(line)) fail();
			}
		}
	}

	function dollar(): void {
		const next = source[pos + 1];
		if (next === "(") {
			pos += 2;
			list(")");
		} else if (next === "{") {
			const end = source.indexOf("}", pos);
			if (end === -1) fail();
			if (/\$\(|\$\{|`/.test(source.slice(pos + 2, end))) fail();
			pos = end + 1;
		} else if (next === "'") {
			pos += 2;
			while (source[pos] !== "'") {
				if (pos >= source.length) fail();
				pos += source[pos] === "\\" ? 2 : 1;
			}
			pos++;
		} else {
			pos++;
			const name = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9#?$!@*-])/.exec(
				source.slice(pos),
			);
			pos += name?.[0].length ?? 0;
		}
	}

	function backtick(): void {
		let inner = "";
		pos++;
		while (source[pos] !== "`") {
			if (pos >= source.length) fail();
			if (source[pos] === "\\" && pos + 1 < source.length) pos++;
			inner += source[pos];
			pos++;
		}
		pos++;
		commands.push(...parse(inner));
	}

	function word(): Word {
		let text = "";
		let bare = "";
		let quoted = false;
		let dynamic = false;
		while (pos < source.length && !/[\s;&|()<>]/.test(source[pos])) {
			const c = source[pos];
			if (c === "'") {
				const end = source.indexOf("'", pos + 1);
				if (end === -1) fail();
				text += source.slice(pos + 1, end);
				quoted = true;
				pos = end + 1;
			} else if (c === '"') {
				quoted = true;
				pos++;
				while (source[pos] !== '"') {
					if (pos >= source.length) fail();
					if (source[pos] === "\\" && '"$`\\\n'.includes(source[pos + 1])) {
						text += source[pos + 1];
						pos += 2;
					} else if (
						source[pos] === "$" &&
						/[({A-Za-z0-9_#?$!@*-]/.test(source[pos + 1] ?? "")
					) {
						dynamic = true;
						dollar();
					} else if (source[pos] === "`") {
						dynamic = true;
						backtick();
					} else {
						text += source[pos];
						pos++;
					}
				}
				pos++;
			} else if (c === "\\") {
				quoted = true;
				if (source[pos + 1] !== "\n") text += source[pos + 1] ?? "";
				pos += 2;
			} else if (
				c === "$" &&
				/[({'A-Za-z0-9_#?$!@*-]/.test(source[pos + 1] ?? "")
			) {
				dynamic = true;
				dollar();
			} else if (c === "`") {
				dynamic = true;
				backtick();
			} else {
				text += c;
				bare += c;
				pos++;
			}
		}
		if (/[*?]|\[.*\]|\{.*\}/.test(bare)) dynamic = true;
		return { text, quoted, dynamic };
	}

	function list(closer?: ")"): void {
		let words: Word[] = [];
		const flush = () => {
			if (words.length > 0) commands.push(words);
			words = [];
		};
		while (pos < source.length) {
			const c = source[pos];
			const rest = source.slice(pos);
			if (c === ")") {
				if (!closer) fail();
				flush();
				pos++;
				return;
			}
			if (c === " " || c === "\t") {
				pos++;
			} else if (rest.startsWith("\\\n")) {
				pos += 2;
			} else if (c === "\n") {
				flush();
				pos++;
				readHeredocs();
			} else if (c === "#") {
				const end = source.indexOf("\n", pos);
				pos = end === -1 ? source.length : end;
			} else if (c === "(") {
				if (words.length > 0) fail();
				pos++;
				list(")");
			} else if ((c === "<" || c === ">") && source[pos + 1] === "(") {
				pos += 2;
				list(")");
			} else if (redirection.test(rest) && (c !== "&" || rest[1] === ">")) {
				const operator = redirection.exec(rest)?.[0] ?? "";
				pos += operator.length;
				while (source[pos] === " " || source[pos] === "\t") pos++;
				const target = word();
				if (target.text === "" && !target.quoted) fail();
				if (operator === "<<" || operator === "<<-") {
					heredocs.push({
						delimiter: target.text,
						quoted: target.quoted,
						tabs: operator === "<<-",
					});
				}
			} else if (separator.test(rest)) {
				flush();
				pos += separator.exec(rest)?.[0].length ?? 1;
			} else {
				const next = word();
				if (
					!next.quoted &&
					/^\d+$/.test(next.text) &&
					/[<>]/.test(source[pos] ?? "")
				) {
					continue;
				}
				words.push(next);
			}
		}
		if (closer) fail();
		flush();
		if (heredocs.length > 0) fail();
	}

	list();
	return commands;
}

function programName(word: Word): string {
	if (word.dynamic) fail();
	return (word.text.split("/").at(-1) ?? "").toLowerCase();
}

function isAssignment(word: Word): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(word.text);
}

function invoked(words: Word[], at: number, found: Set<string>): void {
	const name = programName(words[at]);
	const wrapper = wrappers.get(name);
	if (wrapper) {
		const program = wrapped(words, at, wrapper);
		if (program !== undefined) invoked(words, program, found);
		return;
	}
	const args = words.slice(at + 1);
	if (name === "git" || name === "gh") found.add(name);
	if (name === "eval") {
		for (const program of programs(
			args.map((arg) => (arg.dynamic ? fail() : arg.text)).join(" "),
		)) {
			found.add(program);
		}
	}
	if (name === "find") {
		args.forEach((arg, index) => {
			if (findActions.has(arg.text) && index + 1 < args.length) {
				invoked(args, index + 1, found);
			}
		});
	}
	if (shells.has(name)) {
		let script = false;
		let operand: Word | undefined;
		for (let index = 0; index < args.length && !operand; index++) {
			const arg = args[index];
			if (arg.text === "-o" || arg.text === "+o") index++;
			else if (/^-[A-Za-z]*c/.test(arg.text)) script = true;
			else if (!/^[-+]/.test(arg.text)) operand = arg;
		}
		if (!operand) fail();
		if (script) {
			if (operand.dynamic) fail();
			for (const program of programs(operand.text)) found.add(program);
		}
	}
}

function wrapped(
	words: Word[],
	at: number,
	{ flags, values, operands = 0 }: Wrapper,
): number | undefined {
	let index = at + 1;
	for (; index < words.length; index++) {
		const option = words[index].text;
		if (option === "--") {
			index++;
			break;
		}
		if (!option.startsWith("-") || option === "-") break;
		const name = option.startsWith("--") ? option.split("=")[0] : option;
		if (flags.includes(name) || /^-\d+$/.test(name)) continue;
		if (values.includes(name)) {
			if (name === option) index++;
			continue;
		}
		if (!option.startsWith("--") && values.includes(option.slice(0, 2))) {
			continue;
		}
		fail();
	}
	while (index < words.length && isAssignment(words[index])) index++;
	index += operands;
	return index < words.length ? index : undefined;
}

function inspect(words: Word[], found: Set<string>): void {
	let at = 0;
	while (
		at < words.length &&
		(isAssignment(words[at]) || keywords.has(words[at].text))
	) {
		at++;
	}
	if (at === words.length) return;
	const name = programName(words[at]);
	if (name === "for") return;
	if (unsupported.has(name)) fail();
	invoked(words, at, found);
}

function programs(command: string): Set<string> {
	const found = new Set<string>();
	for (const words of parse(command)) inspect(words, found);
	return found;
}

function refusal(command: string): string | undefined {
	let found: Set<string>;
	try {
		found = programs(command);
	} catch (error) {
		if (error !== unreadable) throw error;
		return "This command could not be read with confidence, so it was not run. It might run git or gh, which stay in the parent while Jev routing is off.";
	}
	const [program] = found;
	return program
		? `This command runs ${program}, so it was not run. git and gh stay in the parent while Jev routing is off.`
		: undefined;
}

export function createChildBashTool(cwd: string) {
	const bash = createBashToolDefinition(cwd);
	return defineTool({
		...bash,
		async execute(...args: Parameters<typeof bash.execute>) {
			const reason = jevRoutingEnabled() ? undefined : refusal(args[1].command);
			if (reason) {
				throw new Error(
					`${reason} Report blocked with this reason, or ask the parent with ask_parent.`,
				);
			}
			return bash.execute(...args);
		},
	});
}
