import { createFileRoute } from "@tanstack/react-router";
import { CodeEditorSettings } from "./components/CodeEditorSettings";

export const Route = createFileRoute("/_authenticated/settings/editor/")({
	component: CodeEditorSettings,
});
