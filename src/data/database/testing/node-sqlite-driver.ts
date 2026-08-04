import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { DatabaseDriver, SqlValue } from "../driver";
import { TransactionQueue } from "../transaction-queue";

function toNodeValues(params: readonly SqlValue[]): SQLInputValue[] {
  return params.map((value) => value);
}

export class NodeSqliteDriver implements DatabaseDriver {
  private readonly database: DatabaseSync;
  private readonly transactions = new TransactionQueue();

  constructor(path: string) {
    this.database = new DatabaseSync(path);
  }

  async exec(sql: string): Promise<void> {
    this.database.exec(sql);
  }

  async run(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<{ changes: number; lastInsertRowId: number }> {
    const result = this.database.prepare(sql).run(...toNodeValues(params));
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async first<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    const row = this.database.prepare(sql).get(...toNodeValues(params));
    return (row as T | undefined) ?? null;
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.database.prepare(sql).all(...toNodeValues(params)) as T[];
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.transactions.run(async () => {
      this.database.exec("BEGIN");
      try {
        const result = await work();
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    this.database.close();
  }
}
