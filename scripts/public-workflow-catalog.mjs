export const publicWorkflowCatalog = [
	{
		name: "define-product",
		title: "Define Product",
		description: "Define a product from a domain anchor under Owner authority.",
		promptDescription: "Define a product from a domain anchor",
		role: "Owner",
		anchorRules:
			"After trimming, any non-empty product idea or problem is exactly one valid domain anchor. Whitespace-only input is missing.",
		inputCondition: "missing",
		anchorQuestion:
			"What product idea or problem should define the domain scope?",
		capability: "implemented",
	},
	{
		name: "deliver-ticket",
		title: "Deliver Ticket",
		description:
			"Deliver an assigned Linear ticket from a domain anchor under Developer authority.",
		promptDescription: "Deliver an assigned Linear ticket from a domain anchor",
		role: "Developer",
		anchorRules:
			"After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.",
		inputCondition: "missing or invalid",
		anchorQuestion: "What Linear Delivery ticket ID anchors this delivery?",
		capability: "pending",
	},
	{
		name: "product-review",
		title: "Product Review",
		description:
			"Review one Linear issue from a domain anchor under Owner authority.",
		promptDescription: "Review one Linear issue from a domain anchor",
		role: "Owner",
		anchorRules:
			"After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.",
		inputCondition: "missing or invalid",
		anchorQuestion: "What single Linear issue ID anchors this product review?",
		capability: "implemented",
	},
	{
		name: "qa-handoff",
		title: "QA Handoff",
		description:
			"Prepare a QA handoff for one Linear issue from a domain anchor under Developer authority.",
		promptDescription:
			"Prepare a QA handoff for one Linear issue from a domain anchor",
		role: "Developer",
		anchorRules:
			"After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.",
		inputCondition: "missing or invalid",
		anchorQuestion: "What single Linear issue ID anchors this QA handoff?",
		capability: "implemented",
	},
];
