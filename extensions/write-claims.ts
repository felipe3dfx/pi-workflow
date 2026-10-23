const SPECIAL = /[*?{}]/;
const MAX_LISTED_PAIRS = 5;

export interface WriteClaim {
	owner: string;
	root: string;
	surfaces: readonly string[];
}

export interface WriteConflict {
	owner: string;
	pairs: Array<[string, string]>;
}

// Lowercased on every filesystem: A.ts and a.ts are one file on case-insensitive volumes.
function normalize(entry: string): string | undefined {
	const value = entry.trim().normalize("NFC");
	if (!value || /^(?:\/|~|[A-Za-z]:)/.test(value)) return undefined;
	const segments = value.split("/").filter((segment) => segment !== "" && segment !== ".");
	if (!segments.length || segments.includes("..")) return undefined;
	return segments.join("/").toLowerCase();
}

// Backslashes stay in the entry because an escape and a separator cannot be told apart.
function uninterpretable(entry: string): boolean {
	if (/[[\]()\\]/.test(entry)) return true;
	return entry.split("/").some((segment) => {
		let depth = 0;
		for (const char of segment) {
			if (char === "{" && ++depth > 1) return true;
			if (char === "}" && --depth < 0) return true;
		}
		return depth !== 0;
	});
}

function segmentRegExp(pattern: string): RegExp {
	let source = "";
	let braces = false;
	for (const char of pattern) {
		if (char === "*") source += "[^/]*";
		else if (char === "?") source += "[^/]";
		else if (char === "{") {
			braces = true;
			source += "(?:";
		} else if (char === "}") {
			braces = false;
			source += ")";
		} else if (char === "," && braces) source += "|";
		else source += char.replace(/[.+^$|\\/()[\]{}]/g, "\\$&");
	}
	return new RegExp(`^${source}$`);
}

function prefix(value: string) {
	const index = value.search(SPECIAL);
	return index < 0 ? value : value.slice(0, index);
}

function suffix(value: string) {
	let index = value.length - 1;
	while (index >= 0 && !SPECIAL.test(value[index])) index -= 1;
	return value.slice(index + 1);
}

function affixesCompatible(a: string, b: string) {
	const [pa, pb, sa, sb] = [prefix(a), prefix(b), suffix(a), suffix(b)];
	return (pa.startsWith(pb) || pb.startsWith(pa)) && (sa.endsWith(sb) || sb.endsWith(sa));
}

function segmentsCompatible(a: string, b: string) {
	const aGlob = SPECIAL.test(a);
	const bGlob = SPECIAL.test(b);
	if (!aGlob && !bGlob) return a === b;
	// One `?` cannot match a character that spans two UTF-16 units.
	if (/\P{ASCII}/u.test(a + b)) return true;
	if (!aGlob || !bGlob) {
		const [literal, pattern] = aGlob ? [b, a] : [a, b];
		return segmentRegExp(pattern).test(literal);
	}
	return affixesCompatible(a, b);
}

export function surfacesOverlap(a: string, b: string): boolean {
	const left = normalize(a);
	const right = normalize(b);
	if (left === undefined || right === undefined || uninterpretable(left) || uninterpretable(right)) {
		return true;
	}
	const as = left.split("/");
	const bs = right.split("/");
	for (let index = 0; index < Math.min(as.length, bs.length); index++) {
		if (as[index] === "**" || bs[index] === "**") return true;
		if (!segmentsCompatible(as[index], bs[index])) return false;
	}
	return true;
}

function entries(surfaces: readonly string[]) {
	return surfaces.length > 0 ? surfaces : ["."];
}

function sameRoot(a: string, b: string) {
	return a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();
}

export function createWriteClaims() {
	const live = new Map<string, WriteClaim>();

	function conflicts(root: string, surfaces: readonly string[]): WriteConflict[] {
		const found: WriteConflict[] = [];
		for (const claim of live.values()) {
			if (!sameRoot(claim.root, root)) continue;
			const pairs: Array<[string, string]> = [];
			for (const mine of entries(surfaces)) {
				for (const theirs of entries(claim.surfaces)) {
					if (surfacesOverlap(mine, theirs)) pairs.push([mine, theirs]);
				}
			}
			if (pairs.length > 0) found.push({ owner: claim.owner, pairs });
		}
		return found;
	}

	return {
		conflicts,
		claim(owner: string, root: string, surfaces: readonly string[]) {
			live.set(owner, { owner, root, surfaces: [...surfaces] });
		},
		release(owner: string) {
			return live.delete(owner);
		},
		rebuild(claims: readonly WriteClaim[]) {
			live.clear();
			for (const claim of claims) live.set(claim.owner, { ...claim });
		},
	};
}

export function conflictReason(found: readonly WriteConflict[]): string {
	const details = found
		.map(({ owner, pairs }) => {
			const listed = pairs
				.slice(0, MAX_LISTED_PAIRS)
				.map(([mine, theirs]) => `\`${mine}\` overlaps \`${theirs}\``)
				.join(", ");
			const more = pairs.length > MAX_LISTED_PAIRS ? ` and ${pairs.length - MAX_LISTED_PAIRS} more` : "";
			return `child ${owner} (${listed}${more})`;
		})
		.join("; ");
	return `The write surfaces overlap a working writer: ${details}. Wait for it to end, declare surfaces disjoint from it, or launch in another worktree.`;
}
