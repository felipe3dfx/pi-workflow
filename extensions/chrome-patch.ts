export type PatchMethod = (...args: never[]) => unknown;
type Marked = PatchMethod & Record<symbol, unknown>;

export type PatchTarget = {
	proto: object;
	name: string;
	create: (original: PatchMethod) => PatchMethod;
	replaces: boolean;
};

function slot(proto: object) {
	return proto as Record<string, Marked | undefined>;
}

function pristine(method: PatchMethod, name: string) {
	return Function.prototype.toString.call(method).startsWith(`${name}(`);
}

export function createPatchSet(setName: string, targets: PatchTarget[]) {
	const original = Symbol.for(`pi-workflow:${setName}:original`);
	const inheritedMark = Symbol.for(`pi-workflow:${setName}:inherited`);
	return {
		patch() {
			for (const { proto, name, create, replaces } of targets) {
				const current = slot(proto)[name];
				if (!current) continue;
				const base = (current[original] as Marked | undefined) ?? current;
				if (replaces && !pristine(base, name)) continue;
				const inherited = current[original]
					? current[inheritedMark]
					: !Object.hasOwn(proto, name);
				const patched = create(base) as Marked;
				patched[original] = base;
				patched[inheritedMark] = inherited;
				slot(proto)[name] = patched;
			}
		},
		restore() {
			for (const { proto, name } of targets) {
				const current = slot(proto)[name];
				if (!current?.[original]) continue;
				if (current[inheritedMark]) delete slot(proto)[name];
				else slot(proto)[name] = current[original] as Marked;
			}
		},
	};
}
