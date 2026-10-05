import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PostHogReady } from "./components/PostHogReady";
import { PostHogProvider } from "./PostHogProvider";

test("first render includes content while telemetry effects have not initialized", () => {
	const markup = renderToStaticMarkup(
		<PostHogProvider>
			<PostHogReady>
				<span>Telemetry</span>
			</PostHogReady>
			<button type="button">Content</button>
		</PostHogProvider>,
	);
	expect(markup).toContain("Content");
	expect(markup).not.toContain("Telemetry");
});
