import type {
	createDeliveryWorkflow,
	DeliveryPlanningResult,
	DeliveryRepositorySnapshot,
} from "./delivery-workflow.ts";

interface RuntimeInput {
	action: "plan" | "apply" | "cancel";
	ticketId: string;
	repository?: DeliveryRepositorySnapshot;
	reason?: string;
}

function fail(code: string, message: string): never {
	throw Object.assign(new Error(message), { code });
}

export function createDeliveryRuntime(dependencies: {
	workflow: ReturnType<typeof createDeliveryWorkflow>;
}) {
	const plans = new Map<string, DeliveryPlanningResult>();
	const toolName = "workflow_deliver_ticket";

	function parseInput(value: unknown): RuntimeInput {
		if (!value || typeof value !== "object")
			fail(
				"PI_WORKFLOW_DELIVERY_ACTION_INVALID",
				"A closed delivery action and ticket ID are required.",
			);
		const input = value as Partial<RuntimeInput>;
		if (
			!input.action ||
			!["plan", "apply", "cancel"].includes(input.action) ||
			!input.ticketId?.trim()
		) {
			fail(
				"PI_WORKFLOW_DELIVERY_ACTION_INVALID",
				"A closed delivery action and ticket ID are required.",
			);
		}
		return input as RuntimeInput;
	}

	async function execute(value: unknown) {
		const input = parseInput(value);
		if (input.action === "plan") {
			if (!input.repository)
				fail(
					"PI_WORKFLOW_REPOSITORY_SNAPSHOT_MISMATCH",
					"Planning requires a verified repository snapshot.",
				);
			const planned = await dependencies.workflow.plan({
				ticketId: input.ticketId,
				repository: input.repository,
			});
			plans.set(input.ticketId, planned);
			return planned;
		}
		if (input.action === "apply") {
			const planning = plans.get(input.ticketId);
			if (!planning)
				fail(
					"PI_WORKFLOW_DELIVERY_PLAN_REQUIRED",
					"Apply requires the exact planning result held by this delivery runtime.",
				);
			if (!input.repository)
				fail(
					"PI_WORKFLOW_REPOSITORY_SNAPSHOT_MISMATCH",
					"Apply requires a verified repository snapshot.",
				);
			const result = await dependencies.workflow.apply({
				ticketId: input.ticketId,
				planning,
				repository: input.repository,
			});
			if (result.status === "completed" || result.status === "cancelled")
				plans.delete(input.ticketId);
			return result;
		}
		const result = await dependencies.workflow.cancel({
			ticketId: input.ticketId,
			reason: input.reason?.trim() || "Cancelled by the Developer.",
		});
		plans.delete(input.ticketId);
		return result;
	}

	function register(pi: { registerTool(tool: Record<string, unknown>): void }) {
		pi.registerTool({
			name: toolName,
			label: "Delivery workflow",
			description:
				"Run the private plan, apply, or cancel phase for the active Delivery ticket.",
			parameters: { type: "object", additionalProperties: false },
			execute: async (_toolCallId: string, input: RuntimeInput) => ({
				content: [{ type: "text", text: JSON.stringify(await execute(input)) }],
				details: {},
			}),
		});
	}

	return { toolName, execute, register };
}
