import test from "node:test";
import assert from "node:assert/strict";

import {
	terminalSafeBlock,
	terminalSafeLine,
} from "../extensions/terminal-safe-text.ts";

const BIDI = [
	"؜",
	"‎",
	"‏",
	"‪",
	"‫",
	"‬",
	"‭",
	"‮",
	"⁦",
	"⁧",
	"⁨",
	"⁩",
];

const unsafe = [
	["C0 NUL", "\u0000"],
	["C0 BEL", "\u0007"],
	["C0 ESC", "\u001b"],
	["C0 US", "\u001f"],
	["DEL", "\u007f"],
	["C1 first", "\u0080"],
	["C1 CSI", "\u009b"],
	["C1 last", "\u009f"],
	...BIDI.map((ch) => [`bidi U+${ch.codePointAt(0).toString(16)}`, ch]),
];

for (const [name, ch] of unsafe) {
	test(`both forms replace ${name} with one space`, () => {
		assert.equal(terminalSafeLine(`a${ch}b`), "a b");
		assert.equal(terminalSafeBlock(`a${ch}b`), "a b");
	});
}

test("an escape sequence loses only its escape character", () => {
	assert.equal(terminalSafeLine("\u001b[2Jx"), " [2Jx");
	assert.equal(terminalSafeBlock("\u001b[2Jx"), " [2Jx");
});

test("the line form replaces newline, tab and carriage return", () => {
	assert.equal(terminalSafeLine("a\nb\tc\rd"), "a b c d");
});

test("the block form keeps newlines, expands tabs to three spaces and replaces carriage returns", () => {
	assert.equal(terminalSafeBlock("a\nb\tc\rd"), "a\nb   c d");
});

test("the empty string stays empty in both forms", () => {
	assert.equal(terminalSafeLine(""), "");
	assert.equal(terminalSafeBlock(""), "");
});

test("neither form trims text", () => {
	assert.equal(terminalSafeLine("  a  "), "  a  ");
	assert.equal(terminalSafeBlock("\n a \n"), "\n a \n");
});

test("safe text passes through unchanged", () => {
	assert.equal(terminalSafeLine("héllo ✓ 😀"), "héllo ✓ 😀");
	assert.equal(terminalSafeBlock("héllo\n✓ 😀"), "héllo\n✓ 😀");
});
