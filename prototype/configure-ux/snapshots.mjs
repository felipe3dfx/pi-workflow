// Prototype evidence: node prototype/configure-ux/snapshots.mjs > prototype/configure-ux/snapshots.txt
import { createConfigGuide } from "./guide.ts";
import { buildModel, scenarios } from "./mocks.ts";

const plain = { fg: (_c, s) => s, bg: (_c, s) => s, bold: (s) => s };
const codes = {
	"tui.select.up": "\x1b[A",
	"tui.select.down": "\x1b[B",
	"tui.select.cancel": "\x1b",
};
const keys = { matches: (data, id) => codes[id] === data };
const K = {
	up: "\x1b[A",
	down: "\x1b[B",
	left: "\x1b[D",
	right: "\x1b[C",
	space: " ",
	enter: "\r",
	tab: "\t",
	esc: "\x1b",
};
const WIDTH = 84;

function run(title, scenario, steps, rows = 40) {
	let outcome = "open";
	const guide = createConfigGuide(
		buildModel(scenario),
		plain,
		keys,
		() => rows,
		(r) => {
			outcome = r.status;
		},
	);
	guide.render(WIDTH);
	for (const step of steps) {
		if (typeof step === "object")
			guide.handleMouse({ button: "left", width: WIDTH, ...step });
		else guide.handleInput(K[step] ?? step);
		guide.render(WIDTH);
	}
	console.log(`### ${title}`);
	const shown = steps.map((s) =>
		typeof s === "object" ? `${s.type}@${s.x},${s.y}` : s,
	);
	console.log(
		`input: ${shown.join(" ") || "(none)"} · terminal rows ${rows} → ${outcome}\n`,
	);
	if (outcome === "open") console.log(guide.render(WIDTH).join("\n"));
	console.log("");
}

run("1. Fresh open (absent selection file)", scenarios.fresh, []);
run("2. Toggle focused: Child session off", scenarios.fresh, ["space"]);
run(
	"3. Choice focused: Delegation mode → orchestrator while Child session off",
	scenarios.fresh,
	["space", "down", "down", "down", "down", "down", "down", "down", "right"],
);
run("4. Companion focused, mixed statuses", scenarios.mixed, [
	"up",
	"up",
	"up",
	"up",
]);
run("5. Esc with pending changes asks before discarding", scenarios.fresh, [
	"space",
	"esc",
]);
run("6. Second Esc discards and closes", scenarios.fresh, [
	"space",
	"esc",
	"esc",
]);
run("7. Tab jumps to Review and apply", scenarios.mixed, [
	"down",
	"space",
	"tab",
]);
run("8. Review screen", scenarios.mixed, ["down", "space", "tab", "enter"]);
run("9. Review with no changes", scenarios.fresh, ["tab", "enter"]);
run("10. Enter on review applies", scenarios.fresh, ["tab", "enter", "enter"]);
run(
	"11. Review on a short terminal scrolls; Apply now and hints stay",
	scenarios.mixed,
	["down", "space", "tab", "enter"],
	18,
);
run("12. Esc from review returns focus to Review and apply", scenarios.mixed, [
	"down",
	"space",
	"tab",
	"enter",
	"esc",
]);
run("13. Mouse click on the Todo row toggles it", scenarios.fresh, [
	{ type: "click", x: 10, y: 4 },
]);
run("14. Mouse wheel moves focus", scenarios.fresh, [
	{ type: "wheel", wheelDelta: 1, x: 10, y: 4 },
	{ type: "wheel", wheelDelta: 1, x: 10, y: 4 },
]);
run(
	"15. Click [×] with pending changes asks before discarding",
	scenarios.fresh,
	["space", { type: "click", x: 78, y: 0 }],
);
run("16. Click Review and apply, then Apply now", scenarios.fresh, [
	{ type: "click", x: 10, y: 21 },
	{ type: "click", x: 10, y: 14 },
]);
