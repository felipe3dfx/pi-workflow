import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export async function eventually(read, condition = (value) => value, attempts = 1000) {
	let value;
	for (let i = 0; i < attempts; i++) {
		value = await read();
		if (condition(value)) return value;
		await delay(5);
	}
	assert.fail(`condition never held: ${JSON.stringify(value)}`);
}
