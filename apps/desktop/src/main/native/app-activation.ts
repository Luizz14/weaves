interface ActivatableWindow {
	show(): void;
	focus(): void;
}

export function createAppActivationHandler<TWindow extends ActivatableWindow>({
	getWindows,
	createWindow,
	onCreateError = (error) =>
		console.error(
			"[desktop-service] Failed to create a window after app activation:",
			error,
		),
}: {
	getWindows: () => readonly TWindow[];
	createWindow: () => Promise<unknown>;
	onCreateError?: (error: unknown) => void;
}): () => void {
	let pendingWindowCreation: Promise<unknown> | null = null;

	return () => {
		const windows = getWindows();
		if (windows.length === 0) {
			if (pendingWindowCreation) return;
			pendingWindowCreation = Promise.resolve()
				.then(createWindow)
				.catch(onCreateError)
				.finally(() => {
					pendingWindowCreation = null;
				});
			void pendingWindowCreation;
			return;
		}

		for (const window of windows) {
			window.show();
			window.focus();
		}
	};
}
