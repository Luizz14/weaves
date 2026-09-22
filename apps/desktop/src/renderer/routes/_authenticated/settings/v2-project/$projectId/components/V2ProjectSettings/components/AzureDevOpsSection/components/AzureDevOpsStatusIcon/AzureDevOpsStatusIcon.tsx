import {
	LuCircleAlert,
	LuCircleCheck,
	LuCircleDashed,
	LuLoaderCircle,
} from "react-icons/lu";
import type { AzureDevOpsDiagnosticStatus } from "../../types";

type AzureDevOpsStatusIconProps = {
	status: AzureDevOpsDiagnosticStatus;
	isFetching: boolean;
};

export function AzureDevOpsStatusIcon({
	status,
	isFetching,
}: AzureDevOpsStatusIconProps) {
	if (isFetching) {
		return (
			<LuLoaderCircle className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
		);
	}
	if (status === "ready") {
		return <LuCircleCheck className="size-5 text-emerald-500" />;
	}
	if (status === "not_configured") {
		return <LuCircleDashed className="size-5 text-muted-foreground" />;
	}
	return <LuCircleAlert className="size-5 text-amber-500" />;
}
