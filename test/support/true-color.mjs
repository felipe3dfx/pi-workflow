import { setCapabilityOverrides } from "@earendil-works/pi-tui";

// Pin the terminal capabilities the base's wide bytes were captured with
// (truecolor, no hyperlinks) for one test, so a theme initialised after this
// call renders the same escapes whatever COLORTERM, TERM or TERM_PROGRAM say.
export function trueColor(t) {
	setCapabilityOverrides({ trueColor: true, hyperlinks: false });
	t.after(() => setCapabilityOverrides({}));
}
