CREATE TABLE `azure_devops_project_configs` (
	`project_id` text PRIMARY KEY NOT NULL,
	`organization_url` text NOT NULL,
	`azure_project` text NOT NULL,
	`repository` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
