import { createFileRoute, Outlet } from "@tanstack/react-router";

export type TasksSearch = {
	tab?:
		| "all"
		| "active"
		| "backlog"
		| "unstarted"
		| "started"
		| "completed"
		| "canceled";
	assignee?: string;
	search?: string;
	type?: "tasks" | "prs" | "issues" | "azure";
	project?: string;
	projects?: string;
	linearProject?: string;
	state?: "open" | "all";
	azureHost?: string;
	iteration?: string;
};

export const Route = createFileRoute("/_authenticated/_dashboard/tasks")({
	component: TasksLayout,
	validateSearch: (search: Record<string, unknown>): TasksSearch => ({
		tab: [
			"all",
			"active",
			"backlog",
			"unstarted",
			"started",
			"completed",
			"canceled",
		].includes(search.tab as string)
			? (search.tab as TasksSearch["tab"])
			: undefined,
		assignee: typeof search.assignee === "string" ? search.assignee : undefined,
		search: typeof search.search === "string" ? search.search : undefined,
		type: ["tasks", "prs", "issues", "azure"].includes(search.type as string)
			? (search.type as TasksSearch["type"])
			: undefined,
		project: typeof search.project === "string" ? search.project : undefined,
		projects: typeof search.projects === "string" ? search.projects : undefined,
		linearProject:
			typeof search.linearProject === "string"
				? search.linearProject
				: undefined,
		state: ["open", "all"].includes(search.state as string)
			? (search.state as TasksSearch["state"])
			: undefined,
		azureHost:
			typeof search.azureHost === "string" ? search.azureHost : undefined,
		iteration:
			typeof search.iteration === "string" ? search.iteration : undefined,
	}),
});

function TasksLayout() {
	return <Outlet />;
}
