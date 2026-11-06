import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";
export const images = sqliteTable("images", {
 id: text("id").primaryKey(), title: text("title").notNull(), caption: text("caption").notNull().default(""), tags: text("tags").notNull().default(""), mime: text("mime").notNull(), width: integer("width").notNull(), height: integer("height").notNull(), bytes: integer("bytes").notNull(), createdAt: integer("created_at").notNull(),
 favorite: integer("favorite").notNull().default(0),
}, table => [index("images_created_at_idx").on(table.createdAt)]);
export const albums = sqliteTable("albums", {
 id: text("id").primaryKey(), name: text("name").notNull(), createdAt: integer("created_at").notNull(),
});
export const albumImages = sqliteTable("album_images", {
 albumId: text("album_id").notNull().references(() => albums.id, { onDelete: "cascade" }),
 imageId: text("image_id").notNull().references(() => images.id, { onDelete: "cascade" }),
}, table => [primaryKey({ columns: [table.albumId, table.imageId] }), index("album_images_image_idx").on(table.imageId)]);
export const settings = sqliteTable("settings", { key: text("key").primaryKey(), value: text("value").notNull() });

export const companionDevices = sqliteTable("companion_devices", {
 id: text("id").primaryKey(), name: text("name").notNull(), tokenHash: text("token_hash").notNull().unique(),
 createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(), lastUsedAt: integer("last_used_at"),
});

export const uploads = sqliteTable("uploads", {
 id: text("id").primaryKey(), uploadId: text("upload_id").notNull(), mime: text("mime").notNull(),
 width: integer("width").notNull(), height: integer("height").notNull(), bytes: integer("bytes").notNull(),
 state: text("state").notNull().default("uploading"), createdAt: integer("created_at").notNull(),
}, table => [index("uploads_created_at_idx").on(table.createdAt)]);

export const imageTagJobs = sqliteTable("image_tag_jobs", {
 imageId: text("image_id").primaryKey(), state: text("state").notNull(), tags: text("tags").notNull().default(""),
 requestedAt: integer("requested_at").notNull(), startedAt: integer("started_at"), lease: text("lease"),
}, table => [index("image_tag_jobs_queue_idx").on(table.state, table.requestedAt)]);
