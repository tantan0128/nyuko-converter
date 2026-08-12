import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import path from "path";

let _db: ReturnType<typeof drizzle> | null = null;

function getDbPath(): string {
  const fromEnv = process.env.DATABASE_PATH;
  if (fromEnv) return fromEnv;
  // デフォルト: リポジトリ直下の data/nyuko.db
  const dataDir = path.resolve(import.meta.dirname, "..", "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "nyuko.db");
}

/**
 * SQLite接続を遅延生成する（Drizzle + better-sqlite3）
 * ローカルツール・テストはDBなしでも動く
 */
export function getDb() {
  if (!_db) {
    try {
      const sqlite = new Database(getDbPath());
      sqlite.pragma("journal_mode = WAL");
      // テーブル自動作成（スキーマと同期）
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          jan TEXT NOT NULL DEFAULT '',
          code TEXT NOT NULL,
          nameKeywords TEXT NOT NULL DEFAULT '',
          deliveryKeywords TEXT NOT NULL DEFAULT '',
          supplier TEXT NOT NULL DEFAULT '',
          syncedAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS gmail_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          messageId TEXT NOT NULL,
          subject TEXT NOT NULL DEFAULT '',
          fromEmail TEXT NOT NULL DEFAULT '',
          filename TEXT NOT NULL DEFAULT '',
          processedAt TEXT NOT NULL,
          rowCount INTEGER NOT NULL DEFAULT 0,
          notFoundCount INTEGER NOT NULL DEFAULT 0,
          csvContent TEXT,
          notFoundContent TEXT,
          supplier TEXT,
          status TEXT NOT NULL DEFAULT 'done',
          downloadedAt TEXT
        );
      `);
      _db = drizzle(sqlite);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
