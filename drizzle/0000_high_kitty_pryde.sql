CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `images_created_at_idx` ON `images` (`created_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
