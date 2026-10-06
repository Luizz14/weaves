import { createContext, type ReactNode, useContext } from "react";

export const FlutterControlsContext = createContext<ReactNode>(null);

export function useFlutterControlsContent() {
	return useContext(FlutterControlsContext);
}
