import { activate as activateBackend } from "react-devtools-inline/backend";
import { initialize as initializeFrontend } from "react-devtools-inline/frontend";
import { createRoot } from "react-dom/client";

let mounted = false;

export function mountReactDevTools(): void {
	if (mounted || process.env.NODE_ENV === "production") return;
	mounted = true;

	const DevTools = initializeFrontend(window);
	const toggle = document.createElement("button");
	toggle.type = "button";
	toggle.textContent = "React DevTools";
	toggle.style.cssText =
		"position:fixed;right:12px;bottom:12px;z-index:2147483647;border:1px solid #555;border-radius:6px;background:#242424;color:#fff;padding:6px 9px;font:12px system-ui;cursor:pointer";

	const panel = document.createElement("div");
	panel.dataset.supersetReactDevtools = "true";
	panel.style.cssText =
		"display:none;position:fixed;inset:0 0 0 auto;z-index:2147483646;width:min(460px,45vw);background:#1e1e1e;border-left:1px solid #444;box-shadow:-8px 0 24px #0006;overflow:auto";

	toggle.addEventListener("click", () => {
		const visible = panel.style.display !== "none";
		panel.style.display = visible ? "none" : "block";
		toggle.textContent = visible ? "React DevTools" : "Hide React DevTools";
	});
	document.body.append(toggle, panel);

	const root = createRoot(panel);
	root.render(
		<DevTools
			hookNamesModuleLoaderFunction={() =>
				import("react-devtools-inline/hookNames")
			}
		/>,
	);
	activateBackend(window);
}
