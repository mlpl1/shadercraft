import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { Colors } from "../constants/theme";
import { CourseProvider } from "../context/course-context";
import { DataProvider } from "../context/data-context";
import { ProgressProvider } from "../context/progress-context";

const screenOptions = {
  contentStyle: { backgroundColor: Colors.background },
  headerShown: false,
};

export default function RootLayout() {
  return (
    <DataProvider>
      <CourseProvider>
        <ProgressProvider>
          <StatusBar style="light" />
          <Stack screenOptions={screenOptions} />
        </ProgressProvider>
      </CourseProvider>
    </DataProvider>
  );
}
