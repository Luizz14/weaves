import { useLingui } from "@lingui/react/macro";
import { Tabs, TabsList, TabsTrigger } from "@superset/ui/tabs";
import { GoIssueOpened } from "react-icons/go";
import { SiLinear } from "react-icons/si";
import { VscAzureDevops } from "react-icons/vsc";
import { shouldShowTaskSourceSwitcher } from "renderer/routes/_authenticated/_dashboard/hooks/useDashboardIntegrationAvailability/availability";
import type { TaskSource } from "../TasksTopBar/TasksTopBar";

const TASK_SOURCES = [
	{ value: "tasks" as const, Icon: SiLinear },
	{ value: "issues" as const, Icon: GoIssueOpened },
	{ value: "azure" as const, Icon: VscAzureDevops },
] as const;

export function TaskSourceSwitcher({
	value,
	sources,
	onChange,
}: {
	value: TaskSource;
	sources: TaskSource[];
	onChange: (source: TaskSource) => void;
}) {
	const { t } = useLingui();
	const taskSourceLabels: Record<TaskSource, string> = {
		tasks: t({
			message: "Linear",
		}),
		issues: t({
			message: "GitHub issues",
		}),
		azure: t({
			message: "Azure DevOps",
		}),
	};
	if (!shouldShowTaskSourceSwitcher(sources)) return null;
	return (
		<Tabs
			value={value}
			onValueChange={(next) => onChange(next as TaskSource)}
			className="flex-row gap-0"
		>
			<TabsList className="h-8 gap-0.5 rounded-md bg-muted/50 p-0.5">
				{TASK_SOURCES.filter((source) => sources.includes(source.value)).map(
					(source) => {
						const Icon = source.Icon;
						return (
							<TabsTrigger
								key={source.value}
								value={source.value}
								className="h-7 rounded-sm px-2 text-xs shadow-none data-[state=active]:shadow-none"
							>
								<Icon className="size-3.5" />
								<span>{taskSourceLabels[source.value]}</span>
							</TabsTrigger>
						);
					},
				)}
			</TabsList>
		</Tabs>
	);
}
