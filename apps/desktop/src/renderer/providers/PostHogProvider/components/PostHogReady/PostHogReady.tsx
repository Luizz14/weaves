import { type ReactNode, useContext } from "react";
import { PostHogInitializationContext } from "../../initialization-context";

export function PostHogReady({ children }: { children: ReactNode }) {
	return useContext(PostHogInitializationContext) ? children : null;
}
