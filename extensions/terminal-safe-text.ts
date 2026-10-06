const UNSAFE_CHARACTERS = /[\p{Cc}\p{Bidi_Control}]/gu;

export function terminalSafeLine(text: string): string {
	return text.replace(UNSAFE_CHARACTERS, " ");
}

export function terminalSafeBlock(text: string): string {
	return text.replace(UNSAFE_CHARACTERS, (ch) =>
		ch === "\n" ? ch : ch === "\t" ? "   " : " ",
	);
}
