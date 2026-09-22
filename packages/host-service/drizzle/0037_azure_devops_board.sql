CREATE TABLE `azure_devops_board_configs` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`organization_url` text NOT NULL,
	`work_item_project` text NOT NULL,
	`team` text NOT NULL,
	`area_path` text NOT NULL,
	`assigned_to` text,
	`work_item_types_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `azure_devops_work_item_states` (
	`work_item_id` integer PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`child_work_item_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
DROP INDEX `pull_requests_repo_pr_unique`;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `repo_project` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `pull_requests_repo_pr_unique` ON `pull_requests` (`repo_provider`,`repo_owner`,`repo_project`,`repo_name`,`pr_number`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `external_work_item_provider` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `external_work_item_id` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `external_work_item_url` text;