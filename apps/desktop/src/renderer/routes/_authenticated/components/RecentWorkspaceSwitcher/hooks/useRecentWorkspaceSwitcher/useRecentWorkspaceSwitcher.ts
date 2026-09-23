import { useEffect, useRef, useState } from "react";
import {
	type RecentV2Workspace,
	useRecentV2Workspaces,
} from "renderer/stores/recent-v2-workspaces";
import { stepSelection } from "../../utils/stepSelection";

// Keystrokes replayed from a focused webview arrive untrusted and never carry
// the Control release, so those sessions commit after a short pause instead.
const UNTRUSTED_COMMIT_DELAY_MS = 900;

export function useRecentWorkspaceSwitcher(
	onCommit: (entry: RecentV2Workspace) => void,
) {
	const entries = useRecentV2Workspaces((state) => state.entries);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const selectedRef = useRef<number | null>(null);
	const entriesRef = useRef(entries);
	const onCommitRef = useRef(onCommit);
	entriesRef.current = entries;
	onCommitRef.current = onCommit;

	useEffect(() => {
		let commitTimer: ReturnType<typeof setTimeout> | null = null;

		const select = (index: number | null) => {
			selectedRef.current = index;
			setSelectedIndex(index);
		};
		const clearTimer = () => {
			if (commitTimer) clearTimeout(commitTimer);
			commitTimer = null;
		};
		const close = () => {
			clearTimer();
			select(null);
		};
		const commit = () => {
			const index = selectedRef.current;
			const entry = index === null ? undefined : entriesRef.current[index];
			close();
			if (entry) onCommitRef.current(entry);
		};

		const onKeyDown = (event: KeyboardEvent) => {
			const isOpen = selectedRef.current !== null;
			if (isOpen && event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				close();
				return;
			}
			if (
				event.key !== "Tab" ||
				!event.ctrlKey ||
				event.metaKey ||
				event.altKey
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			select(
				stepSelection(
					selectedRef.current,
					entriesRef.current.length,
					event.shiftKey,
				),
			);
			if (!event.isTrusted) {
				clearTimer();
				commitTimer = setTimeout(commit, UNTRUSTED_COMMIT_DELAY_MS);
			}
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.key === "Control" && selectedRef.current !== null) {
				commit();
			}
		};

		window.addEventListener("keydown", onKeyDown, { capture: true });
		window.addEventListener("keyup", onKeyUp, { capture: true });
		window.addEventListener("blur", close);
		return () => {
			clearTimer();
			window.removeEventListener("keydown", onKeyDown, { capture: true });
			window.removeEventListener("keyup", onKeyUp, { capture: true });
			window.removeEventListener("blur", close);
		};
	}, []);

	return {
		entries,
		selectedIndex,
		commitIndex: (index: number) => {
			const entry = entries[index];
			selectedRef.current = null;
			setSelectedIndex(null);
			if (entry) onCommit(entry);
		},
	};
}
