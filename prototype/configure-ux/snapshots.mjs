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

function run(title, scenario, steps) {
	let outcome = "open";
	const guide = createConfigGuide(
		buildModel(scenario),
		plain,
		keys,
		() => 40,
		(r) => {
			outcome = r.status;
		},
	);
	for (const step of steps) guide.handleInput(K[step] ?? step);
	console.log(`### ${title}`);
	console.log(`keys: ${steps.join(" ") || "(none)"} → ${outcome}\n`);
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
