import * as SQLite from "expo-sqlite";
import type { AppDatabase } from "./database";

let db: SQLite.SQLiteDatabase | null = null;

export async function initDatabase(): Promise<AppDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync("gardenme.db");
    await db.execAsync("PRAGMA foreign_keys = ON;");
  }
  return db;
}

export function getDatabase(): AppDatabase {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}
