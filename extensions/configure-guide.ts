import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	matchesKey,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import {
	type Hint,
	hintRows,
	type MenuTheme,
	modalFrame,
	modalMetrics,
	sectionRule,
	selectedRow,
} from "./chrome-menus.ts";
import {
	capabilities,
	type Capability,
	planApply,
	type Selection,
} from "./configure.ts";
import { report } from "./model-profiles.ts";
import {
	type DelegationModeName,
	delegationModes,
} from "./workflow-settings.ts";

type GuideState = {
	package: string;
	status: "missing" | "installed" | "error";
};

type Row = {
	kind: "toggle" | "choice";
	label: string;
	description: string;
	values: readonly string[];
	opened: string;
	read(): string;
	write(value: string): void;
	companion?: string;
};

type Keys = { matches(data: string, id: string): boolean };

type GuideOutcome = {
	selection: Selection;
	jevRouting: boolean;
	delegationMode: DelegationModeName;
};

const capabilityCopy: Record<Capability, [label: string, description: string]> =
	{
		"child-session": [
			"Child session",
			"Delegate bounded work to child sessions; shows them above the input and offers spawn_child.",
		],
		todo: ["Todo", "Session task list pinned above the input."],
		"operator-questions": [
			"Operator questions",
			"Lets the agent ask you choices or open questions in a panel.",
		],
		"model-profiles": [
			"Model profiles",
			"Pick a model per role with /workflow:models.",
		],
		codegraph: [
			"CodeGraph",
			"Offers the codegraph tool for structural code search.",
		],
		"compact-rendering": [
			"Compact rendering",
			"Shows Pi's built-in tool calls in compact form. Off restores native rendering.",
		],
	};

const routingCopy =
	"Ask Jev on each message whether the work stays in the parent or goes to a child session. Needs a TypeSafe key.";

const modeCopy: Record<DelegationModeName, string> = {
	opportunistic:
		"the parent decides per message whether to delegate (default).",
	orchestrator:
		"the parent is told to delegate all work to child sessions and keep to conversing, planning, asking, and directing children.",
};

const companionNote = "Off stops expecting it; it is never uninstalled.";
const actionCopy =
	"Opens a summary of every change. Nothing is applied until you confirm there.";
const orchestratorWarning =
	"No effect while Child session is off: the parent has no child tools to delegate with.";

const alwaysOnApply = [
	"Align MCP servers (mcp.json)",
	"Apply default Pi settings",
	"Nothing is uninstalled",
];

const SIDE_GAP = 2;

type Target = { row: number } | "action" | "apply";

function countLabel(count: number) {
	return count === 0
		? "no changes"
		: count === 1
			? "1 change"
			: `${count} changes`;
}

function spreadRow(left: string, right: string, width: number) {
	const room = Math.max(0, width - visibleWidth(right) - SIDE_GAP);
	const shown = truncateToWidth(left, room, "…");
	const gap = " ".repeat(
		Math.max(SIDE_GAP, width - visibleWidth(shown) - visibleWidth(right)),
	);
	return truncateToWidth(`${shown}${gap}${right}`, width, "");
}

function createConfigGuide(
	draft: Selection,
	draftState: { routing: boolean; mode: DelegationModeName },
	companions: readonly { package: string; description?: string }[],
	states: readonly GuideState[],
	seated: Pick<Selection, "capabilities">,
	theme: MenuTheme,
	keys: Keys,
	terminalRows: () => number,
	done: (confirmed: boolean) => void,
): Component {
	const t = theme;
	const sections: { title: string; rows: Row[] }[] = [
		{
			title: "Capabilities",
			rows: capabilities.map((capability) => ({
				kind: "toggle",
				label: capabilityCopy[capability][0],
				description: capabilityCopy[capability][1],
				values: ["on", "off"],
				opened: draft.capabilities[capability] ? "on" : "off",
				read: () => (draft.capabilities[capability] ? "on" : "off"),
				write: (value) => {
					draft.capabilities[capability] = value === "on";
				},
			})),
		},
		{
			title: "Routing and delegation",
			rows: [
				{
					kind: "toggle",
					label: "Jev routing",
					description: routingCopy,
					values: ["on", "off"],
					opened: draftState.routing ? "on" : "off",
					read: () => (draftState.routing ? "on" : "off"),
					write: (value) => {
						draftState.routing = value === "on";
					},
				},
				{
					kind: "choice",
					label: "Delegation mode",
					description: delegationModes
						.map((mode) => `${mode}: ${modeCopy[mode]}`)
						.join("\n"),
					values: delegationModes,
					opened: draftState.mode,
					read: () => draftState.mode,
					write: (value) => {
						draftState.mode = value as DelegationModeName;
					},
				},
			],
		},
		{
			title: "Companions",
			rows: companions.map((companion) => ({
				kind: "toggle",
				label: companion.package,
				description: [companion.description, companionNote]
					.filter(Boolean)
					.join(" "),
				values: ["on", "off"],
				opened: draft.expectations[companion.package] ? "on" : "off",
				read: () => (draft.expectations[companion.package] ? "on" : "off"),
				write: (value) => {
					draft.expectations[companion.package] = value === "on";
				},
				companion: companion.package,
			})),
		},
	];
	const rows = sections.flatMap((section) => section.rows);
	const actionIndex = rows.length;
	let focus = 0;
	let screen: "edit" | "review" = "edit";
	let confirmDiscard = false;
	let reviewOffset = 0;
	let frameWidth = 0;
	let targets: (Target | undefined)[] = [];

	const changed = (row: Row) => row.read() !== row.opened;
	const pending = () => rows.filter(changed).length;
	const installs = () => planApply(draft, states).install.length;
	const summary = () =>
		installs()
			? `${countLabel(pending())} · ${installs()} to install`
			: countLabel(pending());

	function step(row: Row, delta: 1 | -1) {
		const at = row.values.indexOf(row.read());
		row.write(row.values[(at + delta + row.values.length) % row.values.length]);
	}

	function companionStatus(row: Row) {
		const state = states.find((entry) => entry.package === row.companion);
		if (!state) return "";
		if (state.status === "error") return t.fg("error", "unreadable");
		const expected = row.read() === "on";
		if (state.status === "missing")
			return expected
				? t.fg("warning", "will install")
				: t.fg("dim", "not installed");
		return t.fg("dim", expected ? "installed" : "installed · kept");
	}

	function rowLine(row: Row, selected: boolean, width: number) {
		const marker = changed(row) ? t.fg("accent", " •") : "  ";
		const pointer = selected ? t.bold(t.fg("text", "▸ ")) : "  ";
		const label = selected
			? t.bold(t.fg("text", row.label))
			: t.fg("text", row.label);
		let left: string;
		let right: string;
		if (row.kind === "toggle") {
			const on = row.read() === "on";
			const box = on ? t.bold(t.fg("text", "[x]")) : t.fg("dim", "[ ]");
			left = `${pointer}${box} ${label}`;
			right = companionStatus(row);
		} else {
			left = `${pointer}    ${label}`;
			const arrows = (glyph: string) =>
				selected ? t.bold(t.fg("text", glyph)) : t.fg("dim", glyph);
			right = `${arrows("‹")} ${t.fg("text", row.read())} ${arrows("›")}`;
		}
		const line = spreadRow(left, `${right}${marker}`, width);
		return selected ? selectedRow(t, line, width) : line;
	}

	function actionLine(selected: boolean, width: number) {
		const pointer = selected ? t.bold(t.fg("text", "▸ ")) : "  ";
		const name = "Review and apply";
		const label = selected ? t.bold(t.fg("text", name)) : t.fg("text", name);
		const quiet = pending() === 0 && installs() === 0;
		const count = t.fg(quiet ? "dim" : "accent", summary());
		const line = spreadRow(
			`${pointer}${label}`,
			`${count} ${t.fg("dim", "›")}  `,
			width,
		);
		return selected ? selectedRow(t, line, width) : line;
	}

	function describe(width: number): string[] {
		if (focus === actionIndex) {
			return wrapTextWithAnsi(actionCopy, width).map((line) =>
				t.fg("dim", line),
			);
		}
		const row = rows[focus];
		const lines = row.description
			.split("\n")
			.flatMap((part) => wrapTextWithAnsi(part, width))
			.map((line) => t.fg("dim", line));
		const warns =
			row.kind === "choice" &&
			draftState.mode === "orchestrator" &&
			!draft.capabilities["child-session"];
		if (warns) {
			lines.push(
				...wrapTextWithAnsi(orchestratorWarning, width).map((line) =>
					t.fg("warning", line),
				),
			);
		}
		return lines;
	}

	function editHints(): Hint[] {
		const hints: Hint[] = [["↑/↓", "move"]];
		if (focus === actionIndex) hints.push(["Enter", "review"]);
		else if (rows[focus].kind === "toggle") hints.push(["Space", "toggle"]);
		else hints.push(["←/→/Space", "change"]);
		hints.push(["Tab", "go to apply"]);
		hints.push(["Esc", pending() ? "discard changes" : "close"]);
		return hints;
	}

	function renderEdit(inner: number) {
		const list: string[] = [];
		const listTargets: (Target | undefined)[] = [];
		const push = (line: string, target?: Target) => {
			list.push(line);
			listTargets.push(target);
		};
		let selectedAt = 0;
		let index = 0;
		sections.forEach((section, s) => {
			if (s > 0) push("");
			push(sectionRule(t, section.title, inner));
			for (const row of section.rows) {
				if (index === focus) selectedAt = list.length;
				push(rowLine(row, index === focus, inner), { row: index });
				index++;
			}
		});
		push("");
		push(t.fg("border", "─".repeat(inner)));
		if (focus === actionIndex) selectedAt = list.length;
		push(actionLine(focus === actionIndex, inner), "action");
		const detail = ["", ...describe(inner - 2).map((line) => `  ${line}`)];
		const notice = confirmDiscard
			? [
					"",
					...wrapTextWithAnsi(
						`Discard ${countLabel(pending())}? Esc again discards and closes; any other key keeps editing.`,
						inner,
					).map((line) => t.fg("warning", line)),
				]
			: [];
		const tail = ["", ...hintRows(t, editHints(), inner).lines];
		const room = Math.max(
			3,
			terminalRows() - 3 - detail.length - notice.length - tail.length,
		);
		const start =
			list.length > room
				? Math.max(
						0,
						Math.min(selectedAt - Math.floor(room / 2), list.length - room),
					)
				: 0;
		const rest = [...detail, ...notice, ...tail];
		return {
			lines: [...list.slice(start, start + room), ...rest],
			targets: [
				...listTargets.slice(start, start + room),
				...rest.map(() => undefined),
			],
		};
	}

	function reviewLines(inner: number): string[] {
		const lines: string[] = [];
		const changes = rows.filter(changed);
		lines.push(sectionRule(t, "Changes", inner));
		if (changes.length === 0) {
			lines.push(t.fg("dim", "  No changes to your selection."));
		}
		for (const row of changes) {
			lines.push(
				spreadRow(
					`  ${t.fg("text", row.label)}`,
					`${t.fg("dim", row.opened)} → ${t.bold(t.fg("text", row.read()))}  `,
					inner,
				),
			);
		}
		const seating = capabilities
			.filter(
				(capability) =>
					seated.capabilities[capability] !== draft.capabilities[capability],
			)
			.map(
				(capability) =>
					`${draft.capabilities[capability] ? "Seat" : "Unseat"} ${capabilityCopy[capability][0]}`,
			);
		if (seating.length) {
			lines.push("", sectionRule(t, "Seating", inner));
			for (const line of seating) {
				lines.push(`  ${t.fg("text", line)}`);
			}
		}
		const plan = planApply(draft, states);
		const broken = states
			.filter((state) => state.status === "error")
			.map((state) => state.package)
			.filter((name) => draft.expectations[name]);
		if (plan.install.length || broken.length || plan.leaveInstalled.length) {
			lines.push("", sectionRule(t, "Packages", inner));
			for (const name of plan.install) {
				lines.push(
					`  ${t.fg("warning", "+")} ${t.fg("text", `Install ${name}`)}`,
				);
			}
			for (const name of broken) {
				lines.push(
					`  ${t.fg("error", "!")} ${t.fg("text", `${name} is unreadable`)} ${t.fg("dim", "(not reinstalled; see /workflow:doctor)")}`,
				);
			}
			for (const name of plan.leaveInstalled) {
				lines.push(
					`  ${t.fg("dim", "=")} ${t.fg("text", `Keep ${name} installed`)} ${t.fg("dim", "(not uninstalled)")}`,
				);
			}
		}
		lines.push("", sectionRule(t, "Always on apply", inner));
		for (const line of alwaysOnApply) {
			lines.push(`  ${t.fg("dim", "·")} ${t.fg("text", line)}`);
		}
		return lines;
	}

	function renderReview(inner: number) {
		const all = reviewLines(inner);
		const applyLine = selectedRow(
			t,
			t.bold(t.fg("text", "▸ Apply now")),
			inner,
		);
		const fits = (hints: Hint[]) =>
			terminalRows() - 6 - hintRows(t, hints, inner).lines.length;
		const scrolls =
			all.length >
			fits([
				["Enter", "apply"],
				["Esc", "back to edit"],
			]);
		const hints: Hint[] = [
			...(scrolls ? ([["↑/↓", "scroll"]] as Hint[]) : []),
			["Enter", "apply"],
			["Esc", "back to edit"],
		];
		const room = Math.max(1, fits(hints) - (scrolls ? 1 : 0));
		reviewOffset = Math.max(0, Math.min(reviewOffset, all.length - room));
		const shown = scrolls ? all.slice(reviewOffset, reviewOffset + room) : all;
		const more = scrolls
			? [
					t.fg(
						"dim",
						`  ${reviewOffset > 0 ? "↑" : ""}${reviewOffset + room < all.length ? "↓" : ""} more`,
					),
				]
			: [];
		const lines = [
			...shown,
			...more,
			"",
			applyLine,
			"",
			...hintRows(t, hints, inner).lines,
		];
		return {
			lines,
			targets: lines.map((_, i) =>
				i === shown.length + more.length + 1 ? ("apply" as const) : undefined,
			),
		};
	}

	function cancel() {
		if (screen === "review") {
			screen = "edit";
			focus = actionIndex;
		} else if (confirmDiscard || pending() === 0) {
			done(false);
		} else {
			confirmDiscard = true;
		}
	}

	function openReview() {
		focus = actionIndex;
		screen = "review";
		reviewOffset = 0;
	}

	return {
		render(width) {
			frameWidth = width;
			const inner = Math.max(1, modalMetrics(width).inner);
			const view = screen === "edit" ? renderEdit(inner) : renderReview(inner);
			const titleRoom = width - 6 - (modalMetrics(width).close ? 5 : 0);
			const full = `Workflow config${pending() || installs() ? ` · ${summary()}` : ""}`;
			const title =
				screen === "review"
					? "Workflow config › Review"
					: visibleWidth(full) > titleRoom
						? summary()
						: full;
			targets = [undefined, ...view.targets];
			return modalFrame(t, title, ["", ...view.lines], width);
		},
		invalidate() {},
		handleMouse(event: TuiMouseEvent) {
			if (event.type === "wheel" && event.wheelDelta) {
				const delta = event.wheelDelta < 0 ? -1 : 1;
				if (screen === "review") reviewOffset += delta;
				else focus = Math.max(0, Math.min(actionIndex, focus + delta));
				confirmDiscard = false;
				return { handled: true };
			}
			if (event.type !== "click" || event.button !== "left") return undefined;
			const shut = modalMetrics(frameWidth).close;
			if (
				event.y === 0 &&
				shut &&
				event.x >= shut.start &&
				event.x < shut.end
			) {
				cancel();
				return { handled: true };
			}
			const target = targets[event.y - 1];
			if (!target) return undefined;
			confirmDiscard = false;
			if (target === "apply") done(true);
			else if (target === "action") openReview();
			else {
				focus = target.row;
				step(rows[target.row], 1);
			}
			return { handled: true };
		},
		handleInput(data) {
			if (keys.matches(data, "tui.select.cancel")) {
				cancel();
				return;
			}
			if (screen === "review") {
				if (matchesKey(data, Key.enter)) done(true);
				else if (keys.matches(data, "tui.select.up"))
					reviewOffset = Math.max(0, reviewOffset - 1);
				else if (keys.matches(data, "tui.select.down")) reviewOffset++;
				return;
			}
			if (confirmDiscard) {
				confirmDiscard = false;
				return;
			}
			const count = rows.length + 1;
			if (keys.matches(data, "tui.select.up")) {
				focus = (focus - 1 + count) % count;
			} else if (keys.matches(data, "tui.select.down")) {
				focus = (focus + 1) % count;
			} else if (matchesKey(data, Key.tab)) {
				focus = actionIndex;
			} else if (focus === actionIndex) {
				if (matchesKey(data, Key.enter)) openReview();
			} else {
				const row = rows[focus];
				if (matchesKey(data, Key.left) && row.kind === "choice") step(row, -1);
				else if (
					matchesKey(data, Key.right) ||
					matchesKey(data, Key.space) ||
					matchesKey(data, Key.enter)
				)
					step(row, 1);
			}
		},
	};
}

export async function guideSelection(
	ctx: ExtensionCommandContext,
	selection: Selection,
	companions: readonly { package: string; description?: string }[],
	states: readonly GuideState[],
	jevRouting: boolean,
	delegationMode: DelegationModeName,
	seated: Pick<Selection, "capabilities">,
): Promise<GuideOutcome | undefined> {
	if (!ctx.hasUI || ctx.mode !== "tui") {
		report(ctx, "Configure needs the TUI.", "error");
		return undefined;
	}
	const draft: Selection = structuredClone(selection);
	const draftState = { routing: jevRouting, mode: delegationMode };
	let confirmed = false;
	await ctx.ui.custom(
		(tui, theme, keybindings, done) =>
			createConfigGuide(
				draft,
				draftState,
				companions,
				states,
				seated,
				theme,
				keybindings,
				() => tui.terminal.rows,
				(applied) => {
					confirmed = applied;
					done(undefined);
				},
			),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "70%",
				minWidth: 48,
				maxHeight: "100%",
			},
		},
	);
	return confirmed
		? {
				selection: draft,
				jevRouting: draftState.routing,
				delegationMode: draftState.mode,
			}
		: undefined;
}
