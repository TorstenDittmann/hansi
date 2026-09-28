CREATE TABLE `organization_invite_link` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`token` text NOT NULL,
	`created_by` text NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_invite_link_token_unique` ON `organization_invite_link` (`token`);--> statement-breakpoint
CREATE INDEX `organization_invite_link_organization_id_idx` ON `organization_invite_link` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_invite_link_active_org_idx` ON `organization_invite_link` (`organization_id`) WHERE "organization_invite_link"."revoked_at" is null;