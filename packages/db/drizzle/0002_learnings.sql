CREATE TABLE `learnings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`repository_id` integer,
	`body` text NOT NULL,
	`author` text,
	`source_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `learnings_org_repo_idx` ON `learnings` (`organization_id`,`repository_id`);