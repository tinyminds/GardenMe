import type { AppDatabase } from "./database";

class WebInMemoryDb implements AppDatabase {
  async execAsync(_sql: string): Promise<void> {
    // Web fallback: no persistent SQLite. Keeps app runnable on web.
  }

  async runAsync(_sql: string, ..._params: unknown[]): Promise<unknown> {
    return { lastInsertRowId: 0, changes: 0 };
  }

  async getFirstAsync<T>(_sql: string, ..._params: unknown[]): Promise<T | null> {
    return null;
  }

  async getAllAsync<T>(_sql: string, ..._params: unknown[]): Promise<T[]> {
    return [];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    await task();
  }
}

let db: AppDatabase | null = null;

export async function initDatabase(): Promise<AppDatabase> {
  if (!db) {
    db = new WebInMemoryDb();
  }
  return db;
}

export function getDatabase(): AppDatabase {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}
