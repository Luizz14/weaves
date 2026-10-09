import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import { memoizeByKey } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/utils/memoizeByKey";
import { type EditorTheme, getEditorTheme, type Theme } from "shared/themes";

const highlightingBySyntax = memoizeByKey<Extension>(16);

export function getCodeSyntaxHighlighting(theme: Theme): Extension {
	const editorTheme = getEditorTheme(theme);
	return highlightingBySyntax(JSON.stringify(editorTheme.syntax), () =>
		createSyntaxHighlighting(editorTheme),
	);
}

function createSyntaxHighlighting(editorTheme: EditorTheme): Extension {
	return syntaxHighlighting(
		HighlightStyle.define([
			{
				tag: [tags.keyword, tags.operatorKeyword, tags.modifier],
				color: editorTheme.syntax.keyword,
			},
			{
				tag: [tags.comment, tags.lineComment, tags.blockComment],
				color: editorTheme.syntax.comment,
				fontStyle: "italic",
			},
			{
				tag: [tags.string, tags.special(tags.string)],
				color: editorTheme.syntax.string,
			},
			{
				tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null],
				color: editorTheme.syntax.number,
			},
			{
				tag: [
					tags.function(tags.variableName),
					tags.function(tags.propertyName),
					tags.labelName,
				],
				color: editorTheme.syntax.functionCall,
			},
			{
				tag: [tags.variableName, tags.name, tags.propertyName],
				color: editorTheme.syntax.variableName,
			},
			{
				tag: [tags.typeName, tags.definition(tags.typeName)],
				color: editorTheme.syntax.typeName,
			},
			{
				tag: [tags.className],
				color: editorTheme.syntax.className,
			},
			{
				tag: [tags.constant(tags.name), tags.standard(tags.name)],
				color: editorTheme.syntax.constant,
			},
			{
				tag: [tags.regexp, tags.escape, tags.special(tags.regexp)],
				color: editorTheme.syntax.regexp,
			},
			{
				tag: [tags.tagName, tags.angleBracket],
				color: editorTheme.syntax.tagName,
			},
			{
				tag: [tags.attributeName],
				color: editorTheme.syntax.attributeName,
			},
			{
				tag: [tags.invalid],
				color: editorTheme.syntax.invalid,
			},
		]),
	);
}
