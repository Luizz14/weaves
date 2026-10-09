import {
	lintGutter as createLintGutter,
	setDiagnostics,
} from "@codemirror/lint";
import {
	type Compartment,
	EditorState,
	type Extension,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { resolveEditorSettings } from "@superset/shared/editor-settings";
import type { Theme } from "@superset/shared/themes";
import { cn } from "@superset/ui/utils";
import { useQuery } from "@tanstack/react-query";
import {
	type MutableRefObject,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { useEditorSettings } from "renderer/hooks/useEditorSettings";
import { fontSettingsQueryOptions } from "renderer/lib/font-settings";
import type { SharedFileDocument } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore";
import { editorPreferenceExtensions } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/lsp/editorExtensions";
import { useLspCoordinator } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/lsp/LspProvider";
import {
	loadLanguageSupport,
	peekLanguageSupport,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/utils/loadLanguageSupport";
import { useResolvedTheme } from "renderer/stores/theme";
import {
	type CodeEditorAdapter,
	createCodeMirrorAdapter,
} from "./CodeEditorAdapter";
import { createCodeMirrorTheme } from "./createCodeMirrorTheme";
import {
	createEditorState,
	editorCompartments,
	restoreEditorState,
	setViewHandlers,
} from "./editorSetup";
import { saveEditorState, takeEditorState } from "./editorStateCache";
import { getCodeSyntaxHighlighting } from "./syntax-highlighting";

const NO_LANGUAGE: Extension = [];
const LINT_GUTTER = createLintGutter();
const NO_LINT_GUTTER: Extension = [];

const editability = {
	editable: [EditorState.readOnly.of(false), EditorView.editable.of(true)],
	readOnly: [EditorState.readOnly.of(true), EditorView.editable.of(false)],
};

const themePairs = new WeakMap<object, WeakMap<object, Extension>>();

function editorThemeExtension(
	highlighting: Extension,
	theme: Extension,
): Extension {
	let byTheme = themePairs.get(highlighting);
	if (!byTheme) {
		byTheme = new WeakMap();
		themePairs.set(highlighting, byTheme);
	}
	let pair = byTheme.get(theme);
	if (!pair) {
		pair = [highlighting, theme];
		byTheme.set(theme, pair);
	}
	return pair;
}

function reconfigure(
	view: EditorView,
	compartment: Compartment,
	extension: Extension,
) {
	if (compartment.get(view.state) === extension) return;
	view.dispatch({ effects: compartment.reconfigure(extension) });
}

interface CodeEditorProps {
	document?: SharedFileDocument;
	lintGutter?: boolean;
	value: string;
	language: string;
	readOnly?: boolean;
	fillHeight?: boolean;
	className?: string;
	editorRef?: MutableRefObject<CodeEditorAdapter | null>;
	onChange?: (value: string) => void;
	onSave?: () => void;
	initialScrollPosition?: { scrollTop: number; scrollLeft: number };
	onScrollPositionChange?: (position: {
		scrollTop: number;
		scrollLeft: number;
	}) => void;
}

export function CodeEditor({
	document,
	lintGutter = false,
	value,
	language,
	readOnly = false,
	fillHeight = true,
	className,
	editorRef,
	onChange,
	onSave,
	initialScrollPosition,
	onScrollPositionChange,
}: CodeEditorProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const lsp = useLspCoordinator();
	const onChangeRef = useRef(onChange);
	const onSaveRef = useRef(onSave);
	const onScrollPositionChangeRef = useRef(onScrollPositionChange);
	const initialScrollPositionRef = useRef(initialScrollPosition);
	// Guards against re-entrant onChange calls triggered by the value-sync effect's own dispatch.
	const isExternalUpdateRef = useRef(false);
	const { data: fontSettings } = useQuery(fontSettingsQueryOptions);
	const editorFontFamily = fontSettings?.editorFontFamily ?? undefined;
	const editorFontSize = fontSettings?.editorFontSize ?? undefined;
	const editorLineHeight = fontSettings?.editorLineHeight ?? undefined;
	const editorLetterSpacing = fontSettings?.editorLetterSpacing ?? undefined;
	const editorFontWeight = fontSettings?.editorFontWeight ?? undefined;
	const editorLigatures = fontSettings?.editorLigatures ?? undefined;
	const applicationTheme = useResolvedTheme();
	const settings = useEditorSettings();
	const preferences = useMemo(
		() => resolveEditorSettings(settings, language),
		[settings, language],
	);
	const preferencesRef = useRef(preferences);
	preferencesRef.current = preferences;
	const palette = preferences.appearance.palette;
	const activeTheme: Theme = useMemo(
		() =>
			preferences.appearance.theme === "custom" && palette
				? {
						...applicationTheme,
						type: palette.type,
						editor: { colors: palette.colors, syntax: palette.syntax },
					}
				: applicationTheme,
		[applicationTheme, palette, preferences.appearance.theme],
	);
	const preferenceExtension = editorPreferenceExtensions(preferences.editing);
	const themeExtension = editorThemeExtension(
		getCodeSyntaxHighlighting(activeTheme),
		createCodeMirrorTheme(
			activeTheme,
			{
				fontFamily: editorFontFamily,
				fontSize: editorFontSize,
				lineHeight: editorLineHeight,
				letterSpacing: editorLetterSpacing,
				fontWeight: editorFontWeight,
				ligatures: editorLigatures,
			},
			fillHeight,
		),
	);
	const editableExtension = readOnly
		? editability.readOnly
		: editability.editable;
	const lintGutterExtension = lintGutter ? LINT_GUTTER : NO_LINT_GUTTER;

	onChangeRef.current = onChange;
	onSaveRef.current = onSave;
	onScrollPositionChangeRef.current = onScrollPositionChange;

	// biome-ignore lint/correctness/useExhaustiveDependencies: Editor instance is created once and reconfigured via dedicated effects below
	useLayoutEffect(() => {
		if (!containerRef.current) return;

		const configured = {
			preferences: preferenceExtension,
			lintGutter: lintGutterExtension,
			editable: editableExtension,
			theme: themeExtension,
			language: peekLanguageSupport(language) ?? NO_LANGUAGE,
		};
		const restorable = document && !readOnly ? document : null;
		const saved = restorable ? takeEditorState(restorable.id) : undefined;
		const view = new EditorView({
			state: saved
				? restoreEditorState(saved.state, value, configured)
				: createEditorState(value, configured),
			parent: containerRef.current,
			scrollTo: saved?.scroll,
		});
		setViewHandlers(view, {
			onChange: (next) => onChangeRef.current?.(next),
			onSave: () => onSaveRef.current?.(),
			isExternalUpdate: () => isExternalUpdateRef.current,
		});
		const adapter = createCodeMirrorAdapter(view);
		let scrollSnapshot = saved?.scroll ?? view.scrollSnapshot();
		const reportScrollPosition = () => {
			scrollSnapshot = view.scrollSnapshot();
			onScrollPositionChangeRef.current?.({
				scrollTop: view.scrollDOM.scrollTop,
				scrollLeft: view.scrollDOM.scrollLeft,
			});
		};
		view.scrollDOM.addEventListener("scroll", reportScrollPosition, {
			passive: true,
		});
		const savedScrollPosition = initialScrollPositionRef.current;
		if (!saved && savedScrollPosition) {
			view.requestMeasure({
				read: () => savedScrollPosition,
				write: (position) => {
					view.scrollDOM.scrollTop = position.scrollTop;
					view.scrollDOM.scrollLeft = position.scrollLeft;
					// Without a pending request the measure loop stops here and the
					// lines for the restored offset only render on the next frame.
					view.requestMeasure({ read: () => null });
				},
			});
		}
		if (saved?.scroll || savedScrollPosition) {
			// Reading layout runs CodeMirror's pending measure now, so the restored
			// offset is applied before the first paint even when this effect runs
			// inside an animation frame and the scheduled measure would land on the
			// next one.
			view.lineBlockAtHeight(0);
		}

		viewRef.current = view;
		if (editorRef) {
			editorRef.current = adapter;
		}

		return () => {
			// The cleanup can run after the editor DOM has been detached and its
			// scroll offset clamped to zero. The scroll listener already saved the
			// last real position, so do not overwrite it here.
			view.scrollDOM.removeEventListener("scroll", reportScrollPosition);
			if (restorable)
				saveEditorState(
					restorable.id,
					view,
					view.dom.isConnected ? view.scrollSnapshot() : scrollSnapshot,
				);
			if (editorRef?.current === adapter) {
				editorRef.current = null;
			}
			adapter.dispose();
			viewRef.current = null;
		};
	}, []);

	useLayoutEffect(() => {
		const view = viewRef.current;
		if (
			!view ||
			!document ||
			!lsp ||
			readOnly ||
			!preferences.enableLanguageServer
		)
			return;
		const unregister = lsp.registerView(document.absolutePath, view);
		const detach = lsp.attach(document, view, editorCompartments.lsp, {
			preferences: () => preferencesRef.current,
		});
		return () => {
			detach();
			unregister();
			if (viewRef.current !== view) return;
			view.dispatch({ effects: editorCompartments.lsp.reconfigure([]) });
			view.dispatch(setDiagnostics(view.state, []));
		};
	}, [
		document,
		document?.absolutePath,
		lsp,
		readOnly,
		preferences.enableLanguageServer,
	]);

	useLayoutEffect(() => {
		const view = viewRef.current;
		if (view)
			reconfigure(view, editorCompartments.lintGutter, lintGutterExtension);
	}, [lintGutterExtension]);

	useEffect(() => {
		const view = viewRef.current;
		if (view)
			reconfigure(view, editorCompartments.preferences, preferenceExtension);
	}, [preferenceExtension]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;

		const currentValue = view.state.doc.toString();
		if (currentValue === value) return;

		// Guarantee flag reset regardless of whether dispatch throws (e.g. view destroyed between null-check and dispatch).
		isExternalUpdateRef.current = true;
		try {
			view.dispatch({
				changes: {
					from: 0,
					to: view.state.doc.length,
					insert: value,
				},
			});
		} finally {
			isExternalUpdateRef.current = false;
		}
	}, [value]);

	useEffect(() => {
		const view = viewRef.current;
		if (view) reconfigure(view, editorCompartments.theme, themeExtension);
	}, [themeExtension]);

	useEffect(() => {
		const view = viewRef.current;
		if (view) reconfigure(view, editorCompartments.editable, editableExtension);
	}, [editableExtension]);

	useEffect(() => {
		let cancelled = false;

		void loadLanguageSupport(language)
			.then((extension) => {
				if (cancelled) return;
				const view = viewRef.current;
				if (view)
					reconfigure(
						view,
						editorCompartments.language,
						extension ?? NO_LANGUAGE,
					);
			})
			.catch((error) => {
				if (cancelled) return;
				const view = viewRef.current;
				if (!view) return;

				console.error("[CodeEditor] Failed to load language support:", {
					error,
					language,
				});
				reconfigure(view, editorCompartments.language, NO_LANGUAGE);
			});

		return () => {
			cancelled = true;
		};
	}, [language]);

	return (
		<div
			ref={containerRef}
			className={cn(
				"min-w-0",
				fillHeight ? "h-full w-full" : "w-full",
				className,
			)}
		/>
	);
}
