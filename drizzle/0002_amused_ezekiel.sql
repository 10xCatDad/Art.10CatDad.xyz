CREATE TABLE `image_tag_jobs` (
	`image_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	`lease` text
);
--> statement-breakpoint
CREATE INDEX `image_tag_jobs_queue_idx` ON `image_tag_jobs` (`state`,`requested_at`);