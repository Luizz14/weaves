let sharedCtx: CanvasRenderingContext2D | null = null;
export function getCanvasCtx(): CanvasRenderingContext2D | null {
	if (!sharedCtx) {
		sharedCtx = document.createElement("canvas").getContext("2d");
	}
	return sharedCtx;
}

export function isFontAvailable(family: string): boolean {
	const ctx = getCanvasCtx();
	if (!ctx) return false;

	const testString = "mmmmmmmmmmlli10OQ@#$%";
	const fallbacks = ["monospace", "sans-serif"] as const;

	for (const fallback of fallbacks) {
		ctx.font = `72px ${fallback}`;
		const fallbackWidth = ctx.measureText(testString).width;

		ctx.font = `72px "${family}", ${fallback}`;
		const testWidth = ctx.measureText(testString).width;

		if (Math.abs(testWidth - fallbackWidth) > 0.5) {
			return true;
		}
	}
	return false;
}
