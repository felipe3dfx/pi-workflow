import {
	createReviewRouter,
	type ReviewPlanRef,
	type ReviewReceiptV1,
	type ReviewSnapshotV1,
} from "./review-router.ts";

export interface DeliveryReviewLaunch {
	intent: "review";
	lens: "risk" | "resilience" | "reliability" | "readability";
	riskId: string;
	reviewPlanRef: ReviewPlanRef;
}

export function createDeliveryReviewWorkflow(dependencies: {
	launch(request: DeliveryReviewLaunch): Promise<unknown>;
}) {
	const router = createReviewRouter();

	async function run(input: {
		requestId: string;
		snapshot: ReviewSnapshotV1;
		receipts: readonly ReviewReceiptV1[];
	}): Promise<{
		plan: ReturnType<typeof router.plan>;
		outcomes: readonly unknown[];
	}> {
		const plan = router.plan(input);
		const outcomes = [];
		for (const launch of plan.launches) {
			outcomes.push(
				await dependencies.launch({
					intent: launch.intent,
					lens: launch.lens,
					riskId: launch.riskId,
					reviewPlanRef: launch.planRef,
				}),
			);
		}
		return { plan, outcomes };
	}

	return { run };
}
