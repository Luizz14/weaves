import { useEffect, useId, useRef, useState } from "react";
import { FileIcon } from "renderer/lib/fileIcons";
import { useResolvedTheme } from "renderer/stores/theme";
import associations from "resources/zed-icons/associations.json";
import { loadZedIcons } from "../../zedProjectPanel";

type Icon = { viewBox: string; element: Element };
const cache = new Map<string, Promise<Map<string, Icon>>>();
const extensions = Object.keys(associations.extensions).sort(
	(a, b) => b.length - a.length,
);
export function zedFileIconName(fileName: string) {
	const named = Reflect.get(associations.names, fileName);
	if (typeof named === "string") return `zed-${named}`;
	const extension = extensions.find((extension) =>
		fileName.toLowerCase().endsWith(`.${extension}`),
	);
	return extension
		? `zed-${Reflect.get(associations.extensions, extension)}`
		: "zed-default";
}
function symbols(mode: "dark" | "light") {
	const cached = cache.get(mode);
	if (cached) return cached;
	const pending = loadZedIcons(mode).then((sprite) => {
		const document = new DOMParser().parseFromString(
			sprite.spriteSheet ?? "",
			"image/svg+xml",
		);
		return new Map(
			[...document.querySelectorAll("symbol")].map((symbol) => {
				const elements = [symbol, ...symbol.querySelectorAll("*")];
				const colors = elements
					.flatMap((element) => [
						element.getAttribute("fill"),
						element.getAttribute("stroke"),
					])
					.filter(
						(color): color is string =>
							!!color && color !== "none" && color !== "currentColor",
					);
				if (
					colors.length > 0 &&
					colors.every(
						(color) =>
							color === "black" || color === "#000" || color === "#000000",
					)
				)
					for (const element of elements)
						for (const name of ["fill", "stroke"]) {
							const value = element.getAttribute(name);
							if (value === "black" || value === "#000" || value === "#000000")
								element.setAttribute(name, "currentColor");
						}
				return [
					symbol.id,
					{
						viewBox: symbol.getAttribute("viewBox") ?? "0 0 24 24",
						element: symbol,
					},
				];
			}),
		);
	});
	cache.set(mode, pending);
	pending.catch(() => cache.delete(mode));
	return pending;
}
export function ZedFileIcon({
	fileName,
	folder,
	className = "size-4 shrink-0 text-muted-foreground",
}: {
	fileName: string;
	folder?: "closed" | "open";
	className?: string;
}) {
	const theme = useResolvedTheme();
	const svgRef = useRef<SVGSVGElement>(null);
	const id = useId().replaceAll(":", "");
	const [icons, setIcons] = useState<{
		mode: string;
		values: Map<string, Icon>;
	} | null>(null);
	useEffect(() => {
		let cancelled = false;
		void symbols(theme.type)
			.then((values) => {
				if (!cancelled) setIcons({ mode: theme.type, values });
			})
			.catch((error) => console.error("[git-panel] Icons failed", error));
		return () => {
			cancelled = true;
		};
	}, [theme.type]);
	const name = folder
		? folder === "open"
			? "zed-folder-open"
			: "zed-folder"
		: zedFileIconName(fileName);
	const icon = icons?.mode === theme.type ? icons.values.get(name) : null;
	useEffect(() => {
		if (!icon || !svgRef.current) return;
		const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
		for (const attribute of icon.element.attributes)
			if (attribute.name !== "id" && attribute.name !== "viewBox")
				group.setAttribute(attribute.name, attribute.value);
		for (const child of icon.element.childNodes)
			group.appendChild(child.cloneNode(true));
		const ids = new Map(
			[...group.querySelectorAll("[id]")].map((element) => [
				element.id,
				`${id}-${element.id}`,
			]),
		);
		for (const element of [group, ...group.querySelectorAll("*")])
			for (const attribute of [...element.attributes]) {
				let value = attribute.value;
				if (attribute.name === "id") value = ids.get(value) ?? value;
				else
					for (const [original, replacement] of ids)
						value = value
							.replaceAll(`url(#${original})`, `url(#${replacement})`)
							.replace(new RegExp(`^#${original}$`), `#${replacement}`);
				element.setAttribute(attribute.name, value);
			}
		svgRef.current.replaceChildren(group);
	}, [icon, id]);
	if (!icon) return <FileIcon fileName={fileName} className={className} />;
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox={icon.viewBox}
			ref={svgRef}
		/>
	);
}
