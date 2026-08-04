import type { SQLiteDatabase } from "expo-sqlite";

import type { DatabaseDriver, SqlValue } from "./driver";
import { TransactionQueue } from "./transaction-queue";

export class ExpoSqliteDriver implements DatabaseDriver {
  private readonly transactions = new TransactionQueue();

  constructor(private readonly database: SQLiteDatabase) {}

  async exec(sql: string): Promise<void> {
    await this.database.execAsync(sql);
  }

  async run(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<{ changes: number; lastInsertRowId: number }> {
    return this.database.runAsync(sql, [...params]);
  }

  async first<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    return this.database.getFirstAsync<T>(sql, [...params]);
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.database.getAllAsync<T>(sql, [...params]);
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.transactions.run(async () => {
      let result: T | undefined;
      await this.database.withTransactionAsync(async () => {
        result = await work();
      });
      return result as T;
    });
  }

  async close(): Promise<void> {
    await this.database.closeAsync();
  }
}
