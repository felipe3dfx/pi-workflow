export interface Task {
	id: number;
	text: string;
	done: boolean;
}

interface TodoWriteInput {
	text: string;
	done?: boolean;
}

interface TodoUpdateInput {
	text?: string;
	done?: boolean;
}

export interface TodoList {
	list(): Task[];
	write(tasks: TodoWriteInput[]): Task[];
	add(text: string): Task;
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
				done: entry.done ?? false,
			}));
			return list();
		},
		add(text) {
			const task: Task = { id: nextId++, text, done: false };
			tasks.push(task);
			return { ...task };
		},
		update(id, changes) {
			const task = tasks.find((candidate) => candidate.id === id);
			if (!task) return undefined;
			if (changes.text !== undefined) task.text = changes.text;
			if (changes.done !== undefined) task.done = changes.done;
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
