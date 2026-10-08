export const TASK_STATES = ["pending", "in progress", "done", "blocked"] as const;

export type TaskState = (typeof TASK_STATES)[number];

export interface Task {
	id: number;
	text: string;
	state: TaskState;
}

interface TodoWriteInput {
	text: string;
	state?: TaskState;
}

interface TodoUpdateInput {
	text?: string;
	state?: TaskState;
}

export interface TodoList {
	list(): Task[];
	write(tasks: TodoWriteInput[]): Task[];
	add(text: string, state?: TaskState): Task;
	update(id: number, changes: TodoUpdateInput): Task | undefined;
	clear(): void;
	restore(tasks: Task[]): void;
}

export function createTodoList(): TodoList {
	let tasks: Task[] = [];
	let nextId = 1;

	const list = (): Task[] => tasks.map((task) => ({ ...task }));

	return {
		list,
		write(input) {
			tasks = input.map((entry) => ({
				id: nextId++,
				text: entry.text,
				state: entry.state ?? "pending",
			}));
			return list();
		},
		add(text, state = "pending") {
			const task: Task = { id: nextId++, text, state };
			tasks.push(task);
			return { ...task };
		},
		update(id, changes) {
			const task = tasks.find((candidate) => candidate.id === id);
			if (!task) return undefined;
			if (changes.text !== undefined) task.text = changes.text;
			if (changes.state !== undefined) task.state = changes.state;
			return { ...task };
		},
		clear() {
			tasks = [];
		},
		restore(restored) {
			tasks = restored.map((task) => ({ ...task }));
			nextId = tasks.reduce((max, task) => Math.max(max, task.id + 1), nextId);
		},
	};
}
