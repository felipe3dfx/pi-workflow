import assert from "node:assert/strict";

export async function within(promise, what, ms = 10000) {
	let timer;
	const expired = new Promise((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new assert.AssertionError({
						message: `${what} never happened within ${ms} ms`,
					}),
				),
			ms,
		);
	});
	try {
		return await Promise.race([promise, expired]);
	} finally {
		clearTimeout(timer);
	}
}
