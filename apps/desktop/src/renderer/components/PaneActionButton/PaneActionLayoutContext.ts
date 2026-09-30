import { createContext, useContext } from "react";

export const PaneActionLayoutContext = createContext(false);

export function usePaneActionDock() {
	return useContext(PaneActionLayoutContext);
}
