import {
	notifyPlace,
	paintPlace,
	readPlace,
	subscribePlace,
} from "./configure.ts";

export function readHeader() {
	return readPlace("header");
}

export function watchHeader(listener: () => void) {
	return subscribePlace("header", listener);
}

export function notifyHeader() {
	notifyPlace("header");
}

export function paintAboveInput(width: number) {
	return paintPlace("above-input", width);
}

export function paintOverlay(width: number) {
	return paintPlace("overlay", width);
}

export function paintMessageStream(width: number) {
	return paintPlace("message-stream", width);
}
