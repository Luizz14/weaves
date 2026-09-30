import { Tooltip } from "@superset/ui/tooltip";
import type { ComponentProps } from "react";
import { usePaneActionDock } from "./PaneActionLayoutContext";

export function PaneActionTooltip(props: ComponentProps<typeof Tooltip>) {
	const inDock = usePaneActionDock();
	return <Tooltip {...props} open={inDock ? false : props.open} />;
}
