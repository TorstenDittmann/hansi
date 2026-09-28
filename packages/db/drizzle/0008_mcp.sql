CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hint` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`created_by` text,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_idx` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_org_idx` ON `api_keys` (`organization_id`);--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`encrypted_token` text,
	`guidance` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`allowed_tools` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_org_name_idx` ON `mcp_servers` (`organization_id`,`name`);--> statement-breakpoint
CREATE INDEX `mcp_servers_org_idx` ON `mcp_servers` (`organization_id`);