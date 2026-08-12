import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 商品マスターテーブル（スプレッドシートから同期） */
export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jan: text("jan").default("").notNull(),
  code: text("code").notNull(),
  nameKeywords: text("nameKeywords").default("").notNull(),
  deliveryKeywords: text("deliveryKeywords").default("").notNull(),
  supplier: text("supplier").default("").notNull(), // E列: 仕入れ先名
  syncedAt: integer("syncedAt", { mode: "timestamp" }).notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

/** Gmail自動処理ジョブテーブル */
export const gmailJobs = sqliteTable("gmail_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: text("messageId").notNull(),
  subject: text("subject").default("").notNull(),
  fromEmail: text("fromEmail").default("").notNull(),
  filename: text("filename").default("").notNull(),
  processedAt: integer("processedAt", { mode: "timestamp" }).notNull(),
  rowCount: integer("rowCount").default(0).notNull(),
  notFoundCount: integer("notFoundCount").default(0).notNull(),
  csvContent: text("csvContent"),
  notFoundContent: text("notFoundContent"),
  supplier: text("supplier"),
  status: text("status").default("done").notNull(),
  downloadedAt: integer("downloadedAt", { mode: "timestamp" }),
});

export type GmailJob = typeof gmailJobs.$inferSelect;
export type InsertGmailJob = typeof gmailJobs.$inferInsert;
