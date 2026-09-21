import type { ItemInstance } from "@headless-tree/core";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { cn } from "@superset/ui/utils";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	LuClipboard,
	LuCopy,
	LuExternalLink,
	LuFile,
	LuFolder,
	LuFolderOpen,
	LuPencil,
	LuTrash2,
} from "react-icons/lu";
import type { DirectoryEntry } from "shared/file-tree-types";
import { useFileDrag, usePathActions } from "../../../ChangesView/hooks";
import { FileIcon } from "../../utils";

const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;

interface FileTreeItemProps {
	item: ItemInstance<DirectoryEntry>;
	entry: DirectoryEntry;
	rowHeight: number;
	indent: number;
	worktreePath: string;
	projectId?: string;
	onActivate: (entry: DirectoryEntry, openInNewTab?: boolean) => void;
	onOpenInEditor: (entry: DirectoryEntry) => void;
	onNewFile: (parentPath: string) => void;
	onNewFolder: (parentPath: string) => void;
	onRename: (entry: DirectoryEntry) => void;
	onDelete: (entry: DirectoryEntry) => void;
}

export function FileTreeItem({
	item,
	entry,
	rowHeight,
	indent,
	worktreePath,
	projectId,
	onActivate,
	onOpenInEditor,
	onNewFile,
	onNewFolder,
	onRename,
	onDelete,
}: FileTreeItemProps) {
	const reduce = useReducedMotion() ?? false;
	const isFolder = entry.isDirectory;
	const isExpanded = item.isExpanded();
	const level = item.getItemMeta().level;

	const parentPath = isFolder
		? entry.path
		: entry.path.split("/").slice(0, -1).join("/") || worktreePath;

	const { copyPath, copyRelativePath, revealInFinder, openInEditor } =
		usePathActions({
			absolutePath: entry.path,
			relativePath: entry.relativePath,
			worktreePath,
			projectId,
		});

	const fileDragProps = useFileDrag({ absolutePath: entry.path });

	const handleClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (e.metaKey || e.ctrlKey) {
			onOpenInEditor(entry);
		} else if (isFolder) {
			if (isExpanded) {
				item.collapse();
			} else {
				item.expand();
			}
		} else if (e.shiftKey) {
			onActivate(entry, true);
		} else {
			onActivate(entry);
		}
	};

	const handleDoubleClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		onOpenInEditor(entry);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (isFolder) {
				if (isExpanded) {
					item.collapse();
				} else {
					item.expand();
				}
			} else {
				onActivate(entry, e.metaKey || e.ctrlKey ? true : undefined);
			}
		}
	};

	const itemContent = (
		<div
			{...item.getProps()}
			{...fileDragProps}
			data-item-id={item.getId()}
			style={{
				height: rowHeight,
				paddingLeft: level * indent,
			}}
			role="treeitem"
			tabIndex={0}
			aria-selected={item.isSelected()}
			aria-expanded={isFolder ? isExpanded : undefined}
			className={cn(
				"group/file-tree relative flex w-full items-center gap-1 overflow-hidden rounded-sm px-1",
				"cursor-pointer select-none text-muted-foreground outline-none",
				"transition-colors hover:bg-accent/50 hover:text-foreground",
				"focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
				item.isSelected() && "bg-accent font-medium text-foreground",
			)}
			onClick={handleClick}
			onDoubleClick={handleDoubleClick}
			onKeyDown={handleKeyDown}
		>
			{level > 0 ? (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-0 w-px bg-border/70"
					style={{ left: 8 + (level - 1) * indent }}
				/>
			) : null}

			<motion.span
				aria-hidden="true"
				initial={false}
				animate={{ rotate: isExpanded ? 90 : 0 }}
				transition={reduce ? { duration: 0 } : ICON_SWAP}
				className={cn(
					"relative z-10 grid size-4 shrink-0 place-items-center",
					!isFolder && "opacity-0",
				)}
			>
				<ChevronRight className="size-3.5" />
			</motion.span>

			<span
				aria-hidden="true"
				className={cn(
					"relative z-10 grid size-4 shrink-0 place-items-center",
					"text-muted-foreground transition-colors group-hover/file-tree:text-foreground",
					isFolder && isExpanded && "text-foreground",
				)}
			>
				{reduce ? (
					<FileIcon
						fileName={entry.name}
						isDirectory={isFolder}
						isOpen={isExpanded}
						className="size-4"
					/>
				) : (
					<AnimatePresence initial={false} mode="popLayout">
						<motion.span
							key={isFolder ? (isExpanded ? "open" : "closed") : "file"}
							initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
							animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
							exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
							transition={ICON_SWAP}
							className="absolute inset-0 grid place-items-center"
						>
							<FileIcon
								fileName={entry.name}
								isDirectory={isFolder}
								isOpen={isExpanded}
								className="size-4"
							/>
						</motion.span>
					</AnimatePresence>
				)}
			</span>

			<span className="relative z-10 min-w-0 flex-1 truncate text-xs">
				{entry.name}
			</span>
		</div>
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{itemContent}</ContextMenuTrigger>
			<ContextMenuContent className="w-48">
				<ContextMenuItem onClick={() => onNewFile(parentPath)}>
					<LuFile className="mr-2 size-4" />
					New File
				</ContextMenuItem>
				<ContextMenuItem onClick={() => onNewFolder(parentPath)}>
					<LuFolder className="mr-2 size-4" />
					New Folder
				</ContextMenuItem>

				<ContextMenuSeparator />

				<ContextMenuItem onClick={copyPath}>
					<LuClipboard className="mr-2 size-4" />
					Copy Path
				</ContextMenuItem>
				<ContextMenuItem onClick={copyRelativePath}>
					<LuCopy className="mr-2 size-4" />
					Copy Relative Path
				</ContextMenuItem>

				<ContextMenuSeparator />

				<ContextMenuItem onClick={revealInFinder}>
					<LuFolderOpen className="mr-2 size-4" />
					Reveal in Finder
				</ContextMenuItem>
				<ContextMenuItem onClick={openInEditor}>
					<LuExternalLink className="mr-2 size-4" />
					Open in Editor
				</ContextMenuItem>

				<ContextMenuSeparator />

				<ContextMenuItem onClick={() => onRename(entry)}>
					<LuPencil className="mr-2 size-4" />
					Rename
				</ContextMenuItem>
				<ContextMenuItem
					onClick={() => onDelete(entry)}
					className="text-destructive focus:text-destructive"
				>
					<LuTrash2 className="mr-2 size-4" />
					Delete
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
