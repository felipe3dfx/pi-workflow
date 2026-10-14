// Prototype only: evidence for the /workflow:config UX question, not an implementation base.
import {
	type Component,
	Key,
	matchesKey,
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
} from "../../extensions/chrome-menus.ts";

export type CompanionStatus = "installed" | "missing" | "error";

export type ToggleRow = {
	kind: "toggle";
	id: string;
	label: string;
	description: string;
	on: boolean;
	was: boolean;
	status?: CompanionStatus;
};

export type ChoiceRow = {
	kind: "choice";
	id: string;
	label: string;
	descriptions: Record<string, string>;
	values: string[];
	value: string;
	was: string;
};

type Row = ToggleRow | ChoiceRow;

export type GuideSection = { title: string; rows: Row[] };

export type GuideModel = {
	sections: GuideSection[];
	alwaysOnApply: string[];
};

export type GuideResult =
	| { status: "applied"; model: GuideModel }
	| { status: "closed" };

type Keys = { matches(data: string, id: string): boolean };

const SIDE_GAP = 2;

function changed(row: Row) {
	return row.kind === "toggle" ? row.on !== row.was : row.value !== row.was;
}

function onOff(on: boolean) {
	return on ? "on" : "off";
}

function companionStatus(t: MenuTheme, row: ToggleRow) {
	if (!row.status) return "";
	if (row.status === "error") return t.fg("error", "unreadable");
	if (row.status === "missing")
		return row.on
			? t.fg("warning", "will install")
			: t.fg("dim", "not installed");
	return row.on ? t.fg("dim", "installed") : t.fg("dim", "installed · kept");
}

function noteFor(model: GuideModel, row: Row): string | undefined {
	if (row.id !== "delegation-mode" || row.kind !== "choice") return undefined;
	const child = model.sections
		.flatMap((section) => section.rows)
		.find((other) => other.id === "capability:child-session");
	return row.value === "orchestrator" && child?.kind === "toggle" && !child.on
		? "No effect while Child session is off: the parent has no child tools to delegate with."
		: undefined;
}

function spreadRow(left: string, right: string, width: number) {
	const room = Math.max(0, width - visibleWidth(right) - SIDE_GAP);
	const shown = truncateToWidth(left, room, "…");
	const gap = " ".repeat(
		Math.max(SIDE_GAP, width - visibleWidth(shown) - visibleWidth(right)),
	);
	return truncateToWidth(`${shown}${gap}${right}`, width, "");
}

export function createConfigGuide(
	model: GuideModel,
	t: MenuTheme,
	keys: Keys,
	terminalRows: () => number,
	done: (result: GuideResult) => void,
): Component {
	const rows = model.sections.flatMap((section) => section.rows);
	const actionIndex = rows.length;
	let focus = 0;
	let screen: "edit" | "review" = "edit";
	let confirmDiscard = false;

	const pending = () => rows.filter(changed);
	const countLabel = (n: number) =>
		n === 0 ? "no changes" : n === 1 ? "1 change" : `${n} changes`;

	function toggleOrCycle(row: Row, step: 1 | -1) {
		if (row.kind === "toggle") {
			row.on = !row.on;
			return;
		}
		const at = row.values.indexOf(row.value);
		row.value = row.values[(at + step + row.values.length) % row.values.length];
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
			const box = row.on ? t.bold(t.fg("text", "[x]")) : t.fg("dim", "[ ]");
			left = `${pointer}${box} ${label}`;
			right = companionStatus(t, row);
		} else {
			left = `${pointer}    ${label}`;
			const arrows = (glyph: string) =>
				selected ? t.bold(t.fg("text", glyph)) : t.fg("dim", glyph);
			right = `${arrows("‹")} ${t.fg("text", row.value)} ${arrows("›")}`;
		}
		const line = spreadRow(left, `${right}${marker}`, width);
		return selected ? selectedRow(t, line, width) : line;
	}

	function actionLine(selected: boolean, width: number) {
		const n = pending().length;
		const pointer = selected ? t.bold(t.fg("text", "▸ ")) : "  ";
		const label = selected
			? t.bold(t.fg("text", "Review and apply"))
			: t.fg("text", "Review and apply");
		const count =
			n === 0 ? t.fg("dim", "no changes") : t.fg("accent", countLabel(n));
		const line = spreadRow(
			`${pointer}${label}`,
			`${count} ${t.fg("dim", "›")}  `,
			width,
		);
		return selected ? selectedRow(t, line, width) : line;
	}

	function describe(width: number): string[] {
		if (focus === actionIndex) {
			return wrapTextWithAnsi(
				"Opens a summary of every change. Nothing is applied until you confirm there.",
				width,
			).map((line) => t.fg("dim", line));
		}
		const row = rows[focus];
		const text =
			row.kind === "toggle"
				? row.description
				: row.values
						.map((value) => `${value}: ${row.descriptions[value]}`)
						.join("\n");
		const lines = text
			.split("\n")
			.flatMap((part) => wrapTextWithAnsi(part, width))
			.map((line) => t.fg("dim", line));
		const note = noteFor(model, row);
		if (note)
			lines.push(
				...wrapTextWithAnsi(note, width).map((line) => t.fg("warning", line)),
			);
		return lines;
	}

	function editHints(): Hint[] {
		const hints: Hint[] = [["↑/↓", "move"]];
		if (focus === actionIndex) hints.push(["Enter", "review"]);
		else if (rows[focus].kind === "toggle") hints.push(["Space", "toggle"]);
		else hints.push(["←/→", "change"]);
		hints.push(["Tab", "go to apply"]);
		hints.push(["Esc", pending().length ? "discard changes" : "close"]);
		return hints;
	}

	function renderEdit(inner: number): { body: string[]; hints: Hint[] } {
		const list: string[] = [];
		let selectedAt = 0;
		let index = 0;
		model.sections.forEach((section, s) => {
			if (s > 0) list.push("");
			list.push(sectionRule(t, section.title, inner));
			for (const row of section.rows) {
				if (index === focus) selectedAt = list.length;
				list.push(rowLine(row, index === focus, inner));
				index++;
			}
		});
		list.push("");
		list.push(t.fg("border", "─".repeat(inner)));
		if (focus === actionIndex) selectedAt = list.length;
		list.push(actionLine(focus === actionIndex, inner));
		const detail = ["", ...describe(inner - 2).map((line) => `  ${line}`)];
		const notice = confirmDiscard
			? [
					"",
					t.fg(
						"warning",
						`Discard ${countLabel(pending().length)}? Esc again discards and closes; any other key keeps editing.`,
					),
				]
			: [];
		const room = Math.max(
			6,
			terminalRows() - 6 - detail.length - notice.length,
		);
		const start = Math.max(
			0,
			Math.min(selectedAt - Math.floor(room / 2), list.length - room),
		);
		const shown = list.length > room ? list.slice(start, start + room) : list;
		return { body: [...shown, ...detail, ...notice], hints: editHints() };
	}

	function renderReview(inner: number): { body: string[]; hints: Hint[] } {
		const body: string[] = [];
		const changes = pending();
		body.push(sectionRule(t, "Changes", inner));
		if (changes.length === 0) {
			body.push(t.fg("dim", "  No changes to your selection."));
		}
		for (const row of changes) {
			const from = row.kind === "toggle" ? onOff(row.was) : row.was;
			const to = row.kind === "toggle" ? onOff(row.on) : row.value;
			body.push(
				spreadRow(
					`  ${t.fg("text", row.label)}`,
					`${t.fg("dim", from)} → ${t.bold(t.fg("text", to))}  `,
					inner,
				),
			);
		}
		const installs = rows.filter(
			(row): row is ToggleRow =>
				row.kind === "toggle" && row.status === "missing" && row.on,
		);
		const kept = rows.filter(
			(row): row is ToggleRow =>
				row.kind === "toggle" && row.status === "installed" && !row.on,
		);
		const broken = rows.filter(
			(row): row is ToggleRow =>
				row.kind === "toggle" && row.status === "error" && row.on,
		);
		if (installs.length || kept.length || broken.length) {
			body.push("");
			body.push(sectionRule(t, "Packages", inner));
			for (const row of installs)
				body.push(
					`  ${t.fg("warning", "+")} ${t.fg("text", `Install ${row.label}`)}`,
				);
			for (const row of broken)
				body.push(
					`  ${t.fg("error", "!")} ${t.fg("text", `${row.label} is unreadable`)} ${t.fg("dim", "(not reinstalled; see /workflow:doctor)")}`,
				);
			for (const row of kept)
				body.push(
					`  ${t.fg("dim", "=")} ${t.fg("text", `Keep ${row.label} installed`)} ${t.fg("dim", "(not uninstalled)")}`,
				);
		}
		body.push("");
		body.push(sectionRule(t, "Always on apply", inner));
		for (const line of model.alwaysOnApply)
			body.push(`  ${t.fg("dim", "·")} ${t.fg("text", line)}`);
		body.push("");
		body.push(selectedRow(t, `${t.bold(t.fg("text", "▸ Apply now"))}`, inner));
		return {
			body,
			hints: [
				["Enter", "apply"],
				["Esc", "back to edit"],
			],
		};
	}

	return {
		render(width) {
			const inner = Math.max(1, modalMetrics(width).inner);
			const view = screen === "edit" ? renderEdit(inner) : renderReview(inner);
			const title =
				screen === "edit"
					? `Workflow config${pending().length ? ` · ${countLabel(pending().length)}` : ""}`
					: "Workflow config › Review";
			const tail = ["", ...hintRows(t, view.hints, inner).lines];
			return modalFrame(t, title, ["", ...view.body, ...tail], width);
		},
		invalidate() {},
		handleInput(data) {
			if (screen === "review") {
				if (matchesKey(data, Key.enter)) done({ status: "applied", model });
				else if (keys.matches(data, "tui.select.cancel")) screen = "edit";
				return;
			}
			if (confirmDiscard) {
				confirmDiscard = false;
				if (keys.matches(data, "tui.select.cancel")) done({ status: "closed" });
				return;
			}
			const count = rows.length + 1;
			if (keys.matches(data, "tui.select.up")) {
				focus = (focus - 1 + count) % count;
			} else if (keys.matches(data, "tui.select.down")) {
				focus = (focus + 1) % count;
			} else if (matchesKey(data, Key.tab)) {
				focus = actionIndex;
			} else if (keys.matches(data, "tui.select.cancel")) {
				if (pending().length) confirmDiscard = true;
				else done({ status: "closed" });
			} else if (focus === actionIndex) {
				if (matchesKey(data, Key.enter)) screen = "review";
			} else {
				const row = rows[focus];
				if (
					row.kind === "toggle" &&
					(matchesKey(data, Key.space) || matchesKey(data, Key.enter))
				) {
					toggleOrCycle(row, 1);
				} else if (row.kind === "choice") {
					if (matchesKey(data, Key.left)) toggleOrCycle(row, -1);
					else if (
						matchesKey(data, Key.right) ||
						matchesKey(data, Key.space) ||
						matchesKey(data, Key.enter)
					)
						toggleOrCycle(row, 1);
				}
			}
		},
	};
}
