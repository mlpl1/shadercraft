import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { Colors } from "../constants/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: Colors.background },
          headerShown: false,
        }}
      />
    </>
  );
}
