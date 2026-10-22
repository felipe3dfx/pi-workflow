import { Type } from "@earendil-works/pi-ai";
export default function (pi) {
	pi.registerTool({
		name: "prototype_ping",
		label: "Ping",
		description: "Prototype ping",
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: "pong" }], details: {} };
		},
	});
}
