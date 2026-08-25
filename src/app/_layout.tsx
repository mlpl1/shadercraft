import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { Colors } from "../constants/theme";
import { AuthProvider } from "../context/auth-context";
import { CourseProvider } from "../context/course-context";
import { DataProvider } from "../context/data-context";
import { ProgressProvider } from "../context/progress-context";
import { SyncProvider } from "../context/sync-context";
import { SettingsProvider } from "../context/settings-context";

const screenOptions = {
  contentStyle: { backgroundColor: Colors.background },
  headerShown: false,
};

export default function RootLayout() {
  return (
    <DataProvider>
      <SettingsProvider>
        <AuthProvider>
        <SyncProvider>
          <CourseProvider>
            <ProgressProvider>
              <StatusBar style="light" />
              <Stack screenOptions={screenOptions} />
            </ProgressProvider>
          </CourseProvider>
        </SyncProvider>
        </AuthProvider>
      </SettingsProvider>
    </DataProvider>
  );
}
