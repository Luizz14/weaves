export function scheduleStartupMaintenance(
	window: {
		isVisible: () => boolean;
		once: (event: "show", onShow: () => void) => void;
	},
	maintain: () => void,
): void {
	const schedule = () => setImmediate(maintain);
	if (window.isVisible()) {
		schedule();
		return;
	}
	window.once("show", schedule);
}
