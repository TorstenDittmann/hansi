ALTER TABLE `llm_calls` ADD `reasoning_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `llm_calls` ADD `reasoning_effort` text;