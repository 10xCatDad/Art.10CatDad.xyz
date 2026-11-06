CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_id` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` integer NOT NULL,
	`state` text DEFAULT 'uploading' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `uploads_created_at_idx` ON `uploads` (`created_at`);