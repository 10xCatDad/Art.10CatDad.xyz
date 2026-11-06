import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const images = sqliteTable("images", {
 id: text("id").primaryKey(), title: text("title").notNull(), caption: text("caption").notNull().default(""), tags: text("tags").notNull().default(""), mime: text("mime").notNull(), width: integer("width").notNull(), height: integer("height").notNull(), bytes: integer("bytes").notNull(), createdAt: integer("created_at").notNull(),
}, table => [index("images_created_at_idx").on(table.createdAt)]);
export const settings = sqliteTable("settings", { key: text("key").primaryKey(), value: text("value").notNull() });
