import { Component, createRef, type ReactNode } from "react";

interface SidebarScrollAnchorProps {
	virtual: boolean;
	children: ReactNode;
}

interface ScrollAnchor {
	id: string;
	top: number;
	scroller: HTMLElement;
}

export class SidebarScrollAnchor extends Component<SidebarScrollAnchorProps> {
	private root = createRef<HTMLDivElement>();

	getSnapshotBeforeUpdate(
		previous: SidebarScrollAnchorProps,
	): ScrollAnchor | null {
		if (previous.virtual === this.props.virtual) return null;
		const root = this.root.current;
		const scroller = root?.closest<HTMLElement>(
			"[data-sidebar-scroll-container]",
		);
		if (!root || !scroller) return null;
		const viewport = scroller.getBoundingClientRect();
		for (const row of root.querySelectorAll<HTMLElement>(
			"[data-sidebar-row-id]",
		)) {
			const rect = row.getBoundingClientRect();
			if (
				rect.height > 0 &&
				rect.bottom > viewport.top &&
				rect.top < viewport.bottom
			) {
				return { id: row.dataset.sidebarRowId ?? "", top: rect.top, scroller };
			}
		}
		return null;
	}

	componentDidUpdate(
		_previous: SidebarScrollAnchorProps,
		_state: unknown,
		anchor: ScrollAnchor | null,
	) {
		if (!anchor) return;
		const row = [
			...(this.root.current?.querySelectorAll<HTMLElement>(
				"[data-sidebar-row-id]",
			) ?? []),
		].find((element) => element.dataset.sidebarRowId === anchor.id);
		if (row)
			anchor.scroller.scrollTop += row.getBoundingClientRect().top - anchor.top;
	}

	render() {
		return <div ref={this.root}>{this.props.children}</div>;
	}
}
