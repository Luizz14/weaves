import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@superset/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { toast } from "@superset/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@superset/ui/toggle-group";
import { useEffect, useMemo, useState } from "react";
import { HiChevronDown } from "react-icons/hi2";
import {
	createThemeFromColors,
	darkTheme,
	lightTheme,
	slugifyThemeId,
	type Theme,
} from "shared/themes";
import { ColorField } from "./components/ColorField";
import { ThemeLivePreview } from "./components/ThemeLivePreview";

interface CreateThemeDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The theme being edited, or null when creating a new one. */
	editingTheme: Theme | null;
	baseTheme: Theme;
	existingIds: ReadonlySet<string>;
	onSaved: (theme: Theme) => void;
}

interface ColorState {
	background: string;
	foreground: string;
	accent: string;
	border: string;
	muted: string;
	secondary: string;
	destructive: string;
}

function baseColorsForType(type: "dark" | "light", base?: Theme): ColorState {
	const source = base ?? (type === "light" ? lightTheme : darkTheme);
	return {
		background: source.ui.background,
		foreground: source.ui.foreground,
		accent: source.ui.primary,
		border: source.ui.border,
		muted: source.ui.muted,
		secondary: source.ui.secondary,
		destructive: source.ui.destructive,
	};
}

export function CreateThemeDialog({
	open,
	onOpenChange,
	editingTheme,
	baseTheme,
	existingIds,
	onSaved,
}: CreateThemeDialogProps) {
	const { t } = useLingui();
	const isEditing = editingTheme !== null;

	const [name, setName] = useState("");
	const [type, setType] = useState<"dark" | "light">(baseTheme.type);
	const [colors, setColors] = useState<ColorState>(() =>
		baseColorsForType(baseTheme.type, baseTheme),
	);
	const [showAdvanced, setShowAdvanced] = useState(false);

	// Re-seed fields whenever the dialog is opened, either from the theme
	// being edited or from fresh defaults for creating one.
	useEffect(() => {
		if (!open) return;
		if (editingTheme) {
			setName(editingTheme.name);
			setType(editingTheme.type);
			setColors(baseColorsForType(editingTheme.type, editingTheme));
		} else {
			setName("");
			setType(baseTheme.type);
			setColors(baseColorsForType(baseTheme.type, baseTheme));
		}
		setShowAdvanced(false);
	}, [open, editingTheme, baseTheme]);

	const updateColor = (key: keyof ColorState, value: string) => {
		setColors((prev) => ({ ...prev, [key]: value }));
	};

	const handleOpenChange = (next: boolean) => {
		onOpenChange(next);
	};

	const handleTypeChange = (nextType: string) => {
		if (nextType !== "dark" && nextType !== "light") return;
		setType(nextType);
		setColors(baseColorsForType(nextType));
	};

	const previewTheme = useMemo<Theme>(() => {
		try {
			return createThemeFromColors({
				id: "preview",
				name: name.trim() || "preview",
				type,
				...colors,
			});
		} catch {
			return baseTheme;
		}
	}, [name, type, colors, baseTheme]);

	const handleSave = () => {
		const trimmedName = name.trim();
		if (!trimmedName) {
			toast.error(
				t({
					message: "Please enter a theme name",
				}),
			);
			return;
		}

		let id = editingTheme?.id ?? (slugifyThemeId(trimmedName) || "custom-theme");
		if (!editingTheme && existingIds.has(id)) {
			let suffix = 2;
			while (existingIds.has(`${id}-${suffix}`)) suffix++;
			id = `${id}-${suffix}`;
		}

		const theme = createThemeFromColors({
			id,
			name: trimmedName,
			type,
			...colors,
		});

		onSaved(theme);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange} modal>
			<DialogContent className="max-w-[440px]">
				<DialogHeader>
					<DialogTitle>
						{isEditing ? (
							<Trans>Edit theme</Trans>
						) : (
							<Trans>Create theme</Trans>
						)}
					</DialogTitle>
					<DialogDescription className="sr-only">
						<Trans>Create a custom theme by choosing a few key colors.</Trans>
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<ThemeLivePreview theme={previewTheme} />

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="create-theme-name" className="text-xs">
							<Trans>Name</Trans>
						</Label>
						<Input
							id="create-theme-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							autoFocus
							onKeyDown={(event) => {
								if (event.key === "Enter") handleSave();
							}}
						/>
					</div>

					<div className="flex items-center justify-between gap-4">
						<Label className="text-xs text-muted-foreground">
							<Trans>Type</Trans>
						</Label>
						<ToggleGroup
							type="single"
							value={type}
							onValueChange={handleTypeChange}
							variant="outline"
							className="h-8 rounded-md border-0 bg-muted/50 p-0.5"
						>
							<ToggleGroupItem
								value="light"
								className="h-7 border-0 px-3 text-xs data-[state=on]:bg-background data-[state=on]:text-foreground"
							>
								<Trans>Light</Trans>
							</ToggleGroupItem>
							<ToggleGroupItem
								value="dark"
								className="h-7 border-0 px-3 text-xs data-[state=on]:bg-background data-[state=on]:text-foreground"
							>
								<Trans>Dark</Trans>
							</ToggleGroupItem>
						</ToggleGroup>
					</div>

					<div className="flex flex-col divide-y divide-border rounded-lg border border-border px-3">
						<ColorField
							id="create-theme-accent"
							label={t({
								message: "Accent",
							})}
							value={colors.accent}
							onChange={(value) => updateColor("accent", value)}
						/>
						<ColorField
							id="create-theme-background"
							label={t({
								message: "Background",
							})}
							value={colors.background}
							onChange={(value) => updateColor("background", value)}
						/>
						<ColorField
							id="create-theme-foreground"
							label={t({
								message: "Foreground",
							})}
							value={colors.foreground}
							onChange={(value) => updateColor("foreground", value)}
						/>
					</div>

					<Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
						<CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground/80 transition-colors hover:text-muted-foreground">
							<HiChevronDown
								className={`size-3 transition-transform duration-200 ${showAdvanced ? "" : "-rotate-90"}`}
							/>
							<Trans>Advanced</Trans>
						</CollapsibleTrigger>
						<CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
							<div className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border px-3">
								<ColorField
									id="create-theme-border"
									label={t({
										message: "Border",
									})}
									value={colors.border}
									onChange={(value) => updateColor("border", value)}
								/>
								<ColorField
									id="create-theme-muted"
									label={t({
										message: "Muted",
									})}
									value={colors.muted}
									onChange={(value) => updateColor("muted", value)}
								/>
								<ColorField
									id="create-theme-secondary"
									label={t({
										message: "Secondary",
									})}
									value={colors.secondary}
									onChange={(value) => updateColor("secondary", value)}
								/>
								<ColorField
									id="create-theme-destructive"
									label={t({
										message: "Destructive",
									})}
									value={colors.destructive}
									onChange={(value) => updateColor("destructive", value)}
								/>
							</div>
						</CollapsibleContent>
					</Collapsible>
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onClick={() => handleOpenChange(false)}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button type="button" onClick={handleSave}>
						{isEditing ? (
							<Trans>Save changes</Trans>
						) : (
							<Trans>Create theme</Trans>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
