import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { Colors } from "../constants/theme";
import { ProgressProvider } from "../context/progress-context";

export default function RootLayout() {
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
