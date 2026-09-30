import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const source = join(root, "src/resources/zed-icons");
const destination = join(root, "src/resources/public/zed-icons");
await mkdir(destination, { recursive: true });
for (const mode of ["dark", "light"]) {
	let symbols = "";
	for (const name of (await readdir(join(source, mode))).sort()) {
		if (!name.endsWith(".svg")) continue;
		const text = await readFile(join(source, mode, name), "utf8");
		const viewBox = /viewBox="([^"]+)"/.exec(text)?.[1] ?? "0 0 24 24";
		const attributes = /<svg([^>]*)>/.exec(text)?.[1] ?? "";
		const inherited = attributes.replace(
			/\s(?:width|height|viewBox|xmlns|id)="[^"]*"/g,
			"",
		);
		const body = text
			.replace(/^[\s\S]*?<svg[^>]*>/, "")
			.replace(/<\/svg>[\s\S]*$/, "");
		symbols += `<symbol id="zed-${name.slice(0, -4)}" viewBox="${viewBox}" ${inherited}>${body.replaceAll("#DCE0E5", "currentColor")}</symbol>`;
	}
	await writeFile(
		join(destination, `${mode}.svg`),
		`<svg xmlns="http://www.w3.org/2000/svg">${symbols}</svg>`,
	);
}
