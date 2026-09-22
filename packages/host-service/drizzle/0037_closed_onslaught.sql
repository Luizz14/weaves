ALTER TABLE `projects` ADD `merge_target_branch` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `update_remote` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `merge_to_main_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `update_from_main_enabled` integer DEFAULT true NOT NULL;