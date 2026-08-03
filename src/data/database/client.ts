import * as SQLite from "expo-sqlite";

import { ExpoSqliteDriver } from "./expo-sqlite-driver";
import { migrateDatabase } from "./migrations";

export async function openShadercraftDatabase(): Promise<ExpoSqliteDriver> {
  const database = await SQLite.openDatabaseAsync("shadercraft.db");
  const driver = new ExpoSqliteDriver(database);

  try {
    await driver.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    await migrateDatabase(driver);
    return driver;
  } catch (error) {
    await driver.close();
    throw error;
  }
}
