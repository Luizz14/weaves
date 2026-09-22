CREATE TABLE `azure_devops_build_configs` (
	`project_id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`developer_names_json` text NOT NULL,
	`alpha_version_value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
