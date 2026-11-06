CREATE TABLE `album_images` (
	`album_id` text NOT NULL,
	`image_id` text NOT NULL,
	PRIMARY KEY(`album_id`, `image_id`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `album_images_image_idx` ON `album_images` (`image_id`);--> statement-breakpoint
CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `images` ADD `favorite` integer DEFAULT 0 NOT NULL;