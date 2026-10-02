export function classifierRegistry(respond, { provider = "typesafe" } = {}) {
	const requests = [];
	const options = [];
	const jev = {
		type: "classifier",
		id: "jev-latest",
		name: "Jev",
		api: "typesafe-system-one",
		provider,
		baseUrl: "https://api.typesafe.ai/v1/",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 64000,
	};
	return {
		requests,
		options,
		registry: {
			findOfType: (type, wanted, id) =>
				type === "classifier" && wanted === jev.provider && id === jev.id
					? jev
					: undefined,
			classify: async (model, context, request) => {
				requests.push(context);
				options.push(request);
				return {
					api: model.api,
					provider: model.provider,
					model: model.id,
					answers: {},
					stopReason: "stop",
					timestamp: 0,
					...(await respond(context, request)),
				};
			},
		},
	};
}
