import { Trans, useLingui } from "@lingui/react/macro";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@superset/ui/alert-dialog";
import { Button } from "@superset/ui/button";
import { useState } from "react";
import { HiOutlinePencil, HiOutlineTrash } from "react-icons/hi2";
import { ThemeSwatch } from "renderer/components/ThemeSwatch";
import type { Theme } from "shared/themes";

interface CustomThemesListProps {
	themes: Theme[];
	activeThemeId: string;
	onEdit: (theme: Theme) => void;
	onDelete: (theme: Theme) => void;
}

export function CustomThemesList({
	themes,
	activeThemeId,
	onEdit,
	onDelete,
}: CustomThemesListProps) {
	const { t } = useLingui();
	const [themeToDelete, setThemeToDelete] = useState<Theme | null>(null);

	if (themes.length === 0) return null;

	return (
		<div className="flex flex-col divide-y divide-border border-t border-border">
			{themes.map((theme) => (
				<div
					key={theme.id}
					className="flex items-center justify-between gap-3 px-4 py-2"
				>
					<div className="flex min-w-0 items-center gap-2.5">
						<ThemeSwatch theme={theme} />
						<span className="truncate text-sm">{theme.name}</span>
						{theme.id === activeThemeId && (
							<span className="shrink-0 rounded-full bg-fill-selected px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
								<Trans>Active</Trans>
							</span>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-8"
							onClick={() => onEdit(theme)}
							aria-label={t({
								message: "Edit",
							})}
						>
							<HiOutlinePencil className="size-4" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-8 text-muted-foreground hover:text-destructive"
							onClick={() => setThemeToDelete(theme)}
							aria-label={t({
								message: "Delete",
							})}
						>
							<HiOutlineTrash className="size-4" />
						</Button>
					</div>
				</div>
			))}

			<AlertDialog
				open={themeToDelete !== null}
				onOpenChange={(open) => {
					if (!open) setThemeToDelete(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Delete theme?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t({
								message: `Are you sure you want to delete the theme "${themeToDelete?.name}"? This action cannot be undone.`,
							})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => {
								if (themeToDelete) onDelete(themeToDelete);
								setThemeToDelete(null);
							}}
						>
							<Trans>Delete</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
