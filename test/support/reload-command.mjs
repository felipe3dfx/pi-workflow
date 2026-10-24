export default function reloadCommand(pi) {
	pi.registerCommand("test-reload", {
		description: "Reload the extension runtime",
		handler: async (_args, ctx) => {
			await ctx.reload();
		},
	});
}
