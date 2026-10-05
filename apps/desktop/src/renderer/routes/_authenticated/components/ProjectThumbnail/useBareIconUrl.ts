import { useEffect, useState } from "react";

const bareIconCache = new Map<string, string>();

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Could not load icon"));
		img.src = src;
	});
}

// Glyph icons picked in project settings are stored as PNGs with the glyph
// color baked in as a translucent full-bleed tile. Since tile and glyph share
// the same RGB, the tile's alpha can be removed exactly from every pixel.
async function stripBakedTile(src: string): Promise<string> {
	const img = await loadImage(src);
	const canvas = document.createElement("canvas");
	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx || canvas.width === 0 || canvas.height === 0) return src;
	ctx.drawImage(img, 0, 0);
	const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const { data, width, height } = image;

	const cornerOffsets = [
		0,
		(width - 1) * 4,
		(height - 1) * width * 4,
		(height * width - 1) * 4,
	];
	const [first, ...rest] = cornerOffsets;
	const tileAlpha = data[first + 3];
	const isBakedTile =
		tileAlpha > 0 &&
		tileAlpha < 255 &&
		rest.every((offset) =>
			[0, 1, 2, 3].every((c) => data[offset + c] === data[first + c]),
		);
	if (!isBakedTile) return src;

	const a = tileAlpha / 255;
	for (let i = 0; i < data.length; i += 4) {
		const glyphAlpha = (data[i + 3] / 255 - a) / (1 - a);
		data[i + 3] = Math.round(Math.max(0, glyphAlpha) * 255);
	}
	ctx.putImageData(image, 0, 0);
	return canvas.toDataURL("image/png");
}

export function useBareIconUrl(iconUrl: string | null | undefined) {
	const canProcess = !!iconUrl && iconUrl.startsWith("data:image/");
	const [resolved, setResolved] = useState(() =>
		iconUrl && canProcess ? bareIconCache.get(iconUrl) : undefined,
	);

	useEffect(() => {
		if (!iconUrl || !canProcess) return;
		const cached = bareIconCache.get(iconUrl);
		if (cached) {
			setResolved(cached);
			return;
		}
		let cancelled = false;
		stripBakedTile(iconUrl)
			.catch(() => iconUrl)
			.then((result) => {
				bareIconCache.set(iconUrl, result);
				if (!cancelled) setResolved(result);
			});
		return () => {
			cancelled = true;
		};
	}, [iconUrl, canProcess]);

	if (!iconUrl) return null;
	if (!canProcess) return iconUrl;
	return bareIconCache.get(iconUrl) ?? resolved ?? null;
}
