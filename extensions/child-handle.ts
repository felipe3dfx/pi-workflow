import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type {
	AgentSessionEvent,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";

import type { ActionAuthorization } from "./action-authorization.ts";
import type { ChildShell } from "./child-bash.ts";
import type { Checkpoint, CheckpointGrant } from "./child-checkpoint.ts";
import type { ChildResult, PendingAuthorization } from "./child-projection.ts";
import type { CommonToolSources } from "./tool-sources.ts";
import type { ParentProject } from "./web-access.ts";

export const shutdownDeadline = 1000;

export const mcpTools = [
	"mcp__*",
	"list_mcp_resources",
	"list_mcp_resource_templates",
	"read_mcp_resource",
];

export type ChildContext = {
	capacity: number;
	tokens: number | null;
	last: boolean;
};

export function contextReading(
	capacity: unknown,
	tokens: unknown,
): Omit<ChildContext, "last"> | undefined {
	if (!Number.isSafeInteger(capacity) || (capacity as number) <= 0)
		return undefined;
	if (
		tokens !== null &&
		!(Number.isSafeInteger(tokens) && (tokens as number) >= 0)
	)
		return undefined;
	return { capacity: capacity as number, tokens: tokens as number | null };
}

interface ChildSpec {
	authorization?: ActionAuthorization;
	sources?: CommonToolSources;
	cwd: string;
	project: ParentProject;
	role: string;
	model: string;
	thinking: ModelThinkingLevel;
	prompt: string;
	tools: string[];
	shell: ChildShell;
	onEvent(event: AgentSessionEvent): void;
	notify(message: string): void;
	ask(
		question: string,
		signal?: AbortSignal,
		consultation?: string,
	): Promise<string>;
	report(result: ChildResult): void;
	checkpoint?: CheckpointGrant;
	checkpointed(checkpoint: Checkpoint): void;
	context?(state: ChildContext | undefined): void;
	parentSession?: string;
}

export interface ChildHandle {
	sessionId: string;
	entries(): SessionEntry[];
	run(task: string): Promise<string>;
	steer(text: string): Promise<void>;
	clearQueue(): string[];
	abort(): Promise<void>;
	dispose(): Promise<void>;
	removeSession(): Promise<void>;
	pendingAuthorizations?(): PendingAuthorization[];
}

export type ChildSessionFactory = (spec: ChildSpec) => Promise<ChildHandle>;
