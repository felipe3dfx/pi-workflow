import assert from "node:assert/strict";
import test from "node:test";

import {
	SINGLE_USER_AUTHORITY_REVISION,
	createSingleUserAuthoritySession,
} from "../extensions/single-user-authority.ts";

const activeUser = {
	id: "linear-user-1",
	name: "Harness Owner",
	isActive: true,
	isGuest: false,
};

test("captures one active Linear user and projects frozen workflow authorities", () => {
	const session = createSingleUserAuthoritySession();
	assert.equal(session.current("Owner"), undefined);
	assert.deepEqual(session.authenticate(activeUser), { ok: true });

	const owner = session.current("Owner");
	const developer = session.current("Developer");
	assert.deepEqual(owner, {
		actorId: activeUser.id,
		role: "Owner",
		authorityRevision: SINGLE_USER_AUTHORITY_REVISION,
	});
	assert.deepEqual(developer, {
		actorId: activeUser.id,
		role: "Developer",
		authorityRevision: SINGLE_USER_AUTHORITY_REVISION,
	});
	assert.equal(Object.isFrozen(owner), true);
	assert.equal(Object.isFrozen(session.user()), true);
	assert.equal(session.authenticate(activeUser).ok, false);
	assert.equal(session.current("Owner"), owner);
});

test("rejects inactive, guest, and malformed Linear users before caching identity", () => {
	for (const value of [
		{ ...activeUser, isActive: false },
		{ ...activeUser, isGuest: true },
		{ ...activeUser, id: "" },
		{ id: "linear-user-1", isActive: true, isGuest: false },
	]) {
		const session = createSingleUserAuthoritySession();
		assert.equal(session.authenticate(value).ok, false);
		assert.equal(session.current("Owner"), undefined);
	}
});

test("optional compatibility authority constrains identity without changing the default", () => {
	const compatible = createSingleUserAuthoritySession({
		authority: {
			actorId: activeUser.id,
			role: "Owner",
			authorityRevision: "host-policy-r7",
		},
	});
	assert.deepEqual(compatible.authenticate(activeUser), { ok: true });
	assert.equal(compatible.current("Owner").authorityRevision, "host-policy-r7");

	const mismatched = createSingleUserAuthoritySession({
		authority: {
			actorId: "another-user",
			role: "Owner",
			authorityRevision: "host-policy-r7",
		},
	});
	assert.equal(mismatched.authenticate(activeUser).ok, false);
	assert.equal(mismatched.current("Owner"), undefined);
});
