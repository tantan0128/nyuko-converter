import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// TODO: Add your tables here

/** 商品マスターテーブル（スプレッドシートから同期） */
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  jan: varchar("jan", { length: 20 }).default("").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  nameKeywords: text("nameKeywords").default("").notNull(),
  deliveryKeywords: text("deliveryKeywords").default("").notNull(),
  syncedAt: timestamp("syncedAt").defaultNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

/** Gmail自動処理ジョブテーブル */
export const gmailJobs = mysqlTable("gmail_jobs", {
  id: int("id").autoincrement().primaryKey(),
  messageId: varchar("messageId", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }).default("").notNull(),
  fromEmail: varchar("fromEmail", { length: 255 }).default("").notNull(),
  filename: varchar("filename", { length: 255 }).default("").notNull(),
  processedAt: timestamp("processedAt").defaultNow().notNull(),
  rowCount: int("rowCount").default(0).notNull(),
  notFoundCount: int("notFoundCount").default(0).notNull(),
  csvContent: text("csvContent"),
  notFoundContent: text("notFoundContent"),
  supplier: varchar("supplier", { length: 128 }),
  status: varchar("status", { length: 32 }).default("done").notNull(),
});

export type GmailJob = typeof gmailJobs.$inferSelect;
export type InsertGmailJob = typeof gmailJobs.$inferInsert;