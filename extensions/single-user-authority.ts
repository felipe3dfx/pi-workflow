import type { AuthenticatedAuthority } from "./workflow-contracts.ts";

export const SINGLE_USER_AUTHORITY_REVISION = "single-user/v1";

interface AuthenticatedLinearUser {
	readonly id: string;
	readonly name: string;
	readonly isActive: true;
	readonly isGuest: false;
}

export interface SingleUserAuthoritySession {
	authenticate(value: unknown):
		| { readonly ok: true }
		| {
				readonly ok: false;
				readonly reason:
					| "already-authenticated"
					| "invalid-user"
					| "policy-mismatch";
		  };
	current(role: AuthenticatedAuthority["role"]): Readonly<AuthenticatedAuthority> | undefined;
	user(): AuthenticatedLinearUser | undefined;
	clear(): void;
}

const nonEmpty = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value === value.trim();

function authenticatedLinearUser(value: unknown): value is AuthenticatedLinearUser {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		nonEmpty((value as Record<string, unknown>).id) &&
		nonEmpty((value as Record<string, unknown>).name) &&
		(value as Record<string, unknown>).isActive === true &&
		(value as Record<string, unknown>).isGuest === false
	);
}

function compatibleAuthority(value: unknown): value is AuthenticatedAuthority {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		nonEmpty((value as Record<string, unknown>).actorId) &&
		((value as Record<string, unknown>).role === "Owner" ||
			(value as Record<string, unknown>).role === "Developer") &&
		nonEmpty((value as Record<string, unknown>).authorityRevision)
	);
}

export function createSingleUserAuthoritySession(options: {
	readonly authority?: AuthenticatedAuthority;
} = {}): SingleUserAuthoritySession {
	if (options.authority !== undefined && !compatibleAuthority(options.authority))
		throw new Error("Injected authenticated authority is invalid.");
	const policy = options.authority && Object.freeze(structuredClone(options.authority));
	let authenticated: AuthenticatedLinearUser | undefined;
	const projections = new Map<AuthenticatedAuthority["role"], Readonly<AuthenticatedAuthority>>();

	return {
		authenticate(value) {
			if (authenticated)
				return { ok: false, reason: "already-authenticated" };
			if (!authenticatedLinearUser(value))
				return { ok: false, reason: "invalid-user" };
			if (policy && value.id !== policy.actorId)
				return { ok: false, reason: "policy-mismatch" };
			authenticated = Object.freeze(structuredClone(value));
			return { ok: true };
		},
		current(role) {
			if (!authenticated) return undefined;
			const existing = projections.get(role);
			if (existing) return existing;
			const authority = Object.freeze({
				actorId: authenticated.id,
				role,
				authorityRevision:
					policy?.authorityRevision ?? SINGLE_USER_AUTHORITY_REVISION,
			});
			projections.set(role, authority);
			return authority;
		},
		user: () => authenticated,
		clear() {
			authenticated = undefined;
			projections.clear();
		},
	};
}
