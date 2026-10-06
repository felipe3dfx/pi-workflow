import assert from "node:assert/strict";
import test from "node:test";

import { createPatchSet } from "../extensions/chrome-patch.ts";

let counter = 0;
const unique = () => `test-set-${++counter}`;

function fixture() {
	class Base {
		render() {
			return "base";
		}
	}
	class Child extends Base {
		draw() {
			return "draw";
		}
	}
	return { Base, Child };
}

const wrapper = (tag) => (original) =>
	function render() {
		return `${tag}(${original.call(this)})`;
	};

test("patching twice leaves one layer and a single restore brings back the original", () => {
	const { Base } = fixture();
	const pristine = Base.prototype.render;
	const set = createPatchSet(unique(), [
		{
			proto: Base.prototype,
			name: "render",
			create: wrapper("A"),
			replaces: false,
		},
	]);
	set.patch();
	set.patch();
	assert.equal(new Base().render(), "A(base)");
	set.restore();
	assert.equal(Base.prototype.render, pristine);
});

test("a replacing target is left alone after another extension replaced the method", () => {
	const { Base } = fixture();
	const foreign = function foreign() {
		return "foreign";
	};
	Base.prototype.render = foreign;
	const set = createPatchSet(unique(), [
		{
			proto: Base.prototype,
			name: "render",
			create: () =>
				function render() {
					return "mine";
				},
			replaces: true,
		},
	]);
	set.patch();
	assert.equal(Base.prototype.render, foreign);
	set.restore();
	assert.equal(Base.prototype.render, foreign);
});

test("a wrapping target wraps whatever method is current", () => {
	const { Base } = fixture();
	Base.prototype.render = function foreign() {
		return "foreign";
	};
	const set = createPatchSet(unique(), [
		{
			proto: Base.prototype,
			name: "render",
			create: wrapper("A"),
			replaces: false,
		},
	]);
	set.patch();
	assert.equal(new Base().render(), "A(foreign)");
});

test("a target absent on its prototype is skipped", () => {
	const { Base } = fixture();
	const set = createPatchSet(unique(), [
		{
			proto: Base.prototype,
			name: "missing",
			create: wrapper("A"),
			replaces: false,
		},
	]);
	set.patch();
	assert.equal(Object.hasOwn(Base.prototype, "missing"), false);
	set.restore();
	assert.equal(Object.hasOwn(Base.prototype, "missing"), false);
});

test("restoring leaves a method that another extension wrapped on top", () => {
	const { Base } = fixture();
	const set = createPatchSet(unique(), [
		{
			proto: Base.prototype,
			name: "render",
			create: wrapper("A"),
			replaces: false,
		},
	]);
	set.patch();
	const layer = Base.prototype.render;
	const foreignWrapper = function foreignWrapper() {
		return `F(${layer.call(this)})`;
	};
	Base.prototype.render = foreignWrapper;
	set.restore();
	assert.equal(Base.prototype.render, foreignWrapper);
});

test("restoring removes an inherited method that was patched", () => {
	const { Child } = fixture();
	const set = createPatchSet(unique(), [
		{
			proto: Child.prototype,
			name: "render",
			create: wrapper("A"),
			replaces: false,
		},
	]);
	set.patch();
	assert.equal(Object.hasOwn(Child.prototype, "render"), true);
	assert.equal(new Child().render(), "A(base)");
	set.restore();
	assert.equal(Object.hasOwn(Child.prototype, "render"), false);
	assert.equal(new Child().render(), "base");
});

test("restoring puts back the original of a method the prototype owned", () => {
	const { Child } = fixture();
	const pristine = Child.prototype.draw;
	const set = createPatchSet(unique(), [
		{
			proto: Child.prototype,
			name: "draw",
			create: wrapper("A"),
			replaces: false,
		},
	]);
	set.patch();
	assert.notEqual(Child.prototype.draw, pristine);
	set.restore();
	assert.equal(Child.prototype.draw, pristine);
});

test("two sets with different names on one prototype never take each other's layer as the original", () => {
	const { Base } = fixture();
	const pristine = Base.prototype.render;
	const one = createPatchSet(unique(), [
		{
			proto: Base.prototype,
			name: "render",
			create: wrapper("A"),
			replaces: false,
		},
	]);
	const two = createPatchSet(unique(), [
		{
			proto: Base.prototype,
			name: "render",
			create: wrapper("B"),
			replaces: false,
		},
	]);
	one.patch();
	two.patch();
	assert.equal(new Base().render(), "B(A(base))");
	two.restore();
	one.restore();
	assert.equal(Base.prototype.render, pristine);
});

test("the same name loaded again recognizes its earlier layer", () => {
	const { Base } = fixture();
	const pristine = Base.prototype.render;
	const name = unique();
	const target = {
		proto: Base.prototype,
		name: "render",
		create: wrapper("A"),
		replaces: false,
	};
	createPatchSet(name, [target]).patch();
	const reloaded = createPatchSet(name, [target]);
	reloaded.patch();
	assert.equal(new Base().render(), "A(base)");
	reloaded.restore();
	assert.equal(Base.prototype.render, pristine);
});
