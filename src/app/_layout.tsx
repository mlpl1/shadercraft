import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Colors } from "../constants/theme";
import { ProgressProvider } from "../context/progress-context";
import { openShadercraftDatabase } from "../data/database/client";
import type { DatabaseDriver } from "../data/database/driver";

export default function RootLayout() {
  const [databaseState, setDatabaseState] = useState<
    { status: "loading" } | { status: "ready" } | { error: Error; status: "error" }
  >({ status: "loading" });

  useEffect(() => {
    let active = true;
    let driver: DatabaseDriver | null = null;

    void openShadercraftDatabase()
      .then(async (openedDriver) => {
        driver = openedDriver;
        if (active) {
          setDatabaseState({ status: "ready" });
        } else {
          await openedDriver.close();
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setDatabaseState({
            error: error instanceof Error ? error : new Error("Database startup failed"),
            status: "error",
          });
        }
      });

    return () => {
      active = false;
      if (driver) {
        void driver.close();
      }
    };
  }, []);

  if (databaseState.status === "loading") {
    return (
      <View style={styles.startupContainer}>
        <ActivityIndicator color={Colors.accent} />
        <Text style={styles.startupText}>Preparing Shadercraft…</Text>
      </View>
    );
  }

  if (databaseState.status === "error") {
    return (
      <View style={styles.startupContainer}>
        <Text style={styles.errorTitle}>Could not open Shadercraft</Text>
        <Text style={styles.startupText}>{databaseState.error.message}</Text>
      </View>
    );
  }

  return (
    <ProgressProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: Colors.background },
          headerShown: false,
        }}
      />
    </ProgressProvider>
  );
}

const styles = StyleSheet.create({
  errorTitle: {
    color: Colors.coral,
    fontSize: 18,
    fontWeight: "700",
  },
  startupContainer: {
    alignItems: "center",
    backgroundColor: Colors.background,
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  startupText: {
    color: Colors.textMuted,
    textAlign: "center",
  },
});
