import { PostHogContext } from "posthog-js/react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { track } from "renderer/lib/analytics";
import { initPostHog, posthog } from "renderer/lib/posthog";
import { PostHogInitializationContext } from "./initialization-context";
import { getCachedPostHogBootstrap } from "./utils/cached-bootstrap/cached-bootstrap";

interface PostHogProviderProps {
	children: React.ReactNode;
}

export function PostHogProvider({ children }: PostHogProviderProps) {
	const [isInitialized, setIsInitialized] = useState(false);

	useEffect(() => {
		try {
			initPostHog();
			track("desktop_opened");
		} catch (error) {
			console.error("[posthog] Failed to initialize:", error);
		} finally {
			setIsInitialized(true);
		}
	}, []);

	const context = useMemo(
		() => ({
			client: posthog,
			bootstrap: isInitialized ? getCachedPostHogBootstrap(posthog) : undefined,
		}),
		[isInitialized],
	);

	return (
		<PostHogContext.Provider value={context}>
			<PostHogInitializationContext.Provider value={isInitialized}>
				{children}
			</PostHogInitializationContext.Provider>
		</PostHogContext.Provider>
	);
}
