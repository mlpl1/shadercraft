export type SqlValue = string | number | null | Uint8Array;

export interface DatabaseDriver {
  exec(sql: string): Promise<void>;
  run(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<{ changes: number; lastInsertRowId: number }>;
  first<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
