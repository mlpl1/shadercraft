import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { SymbolViewProps } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "./app-icon";
import { Colors, Spacing } from "../constants/theme";

export type BottomTab = "home" | "course" | "tutorials" | "editor" | "settings";

type BottomNavigationProps = {
  activeItem: BottomTab;
  onBeforeNavigate?: () => Promise<boolean | void>;
};

const items = [
  {
    key: "home",
    label: "Home",
    icon: { android: "home", ios: "house.fill", web: "home" } as const,
    fallback: "H",
  },
  {
    key: "course",
    label: "Course",
    icon: { android: "book_2", ios: "book.fill", web: "book_2" } as const,
    fallback: "C",
  },
  {
    key: "tutorials",
    label: "Practice",
    icon: { android: "fitness_center", ios: "hammer.fill", web: "build" } as const,
    fallback: "P",
  },
  {
    key: "editor",
    label: "Editor",
    icon: {
      android: "code",
      ios: "chevron.left.forwardslash.chevron.right",
      web: "code",
    } as const,
    fallback: "</>",
  },
  {
    key: "settings",
    label: "Settings",
    icon: { android: "settings", ios: "gearshape.fill", web: "settings" } as const,
    fallback: "S",
  },
] satisfies readonly {
  key: BottomTab;
  label: string;
  icon: SymbolViewProps["name"];
  fallback: string;
}[];

export function BottomNavigation({ activeItem, onBeforeNavigate }: BottomNavigationProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const navigate = async (destination: BottomTab) => {
    if (destination === activeItem) return;
    if (onBeforeNavigate && (await onBeforeNavigate()) === false) return;

    if (destination === "home") {
      router.replace("/");
      return;
    }

    if (destination === "course") {
      router.replace("/course");
      return;
    }

    if (destination === "tutorials") {
      router.replace("/tutorials");
      return;
    }

    if (destination === "editor") {
      router.replace("/library");
      return;
    }

    router.replace("/settings");
  };

  return (
    <View style={[styles.shell, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View accessibilityRole="tablist" style={styles.navigation}>
        {items.map((item) => {
          const active = item.key === activeItem;
          const color = active ? Colors.accent : Colors.textMuted;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={item.key}
              onPress={() => void navigate(item.key)}
              style={({ pressed }) => [styles.item, pressed && styles.pressedItem]}
            >
              <AppIcon
                color={color}
                fallback={item.fallback}
                name={item.icon}
                size={23}
              />
              <Text style={[styles.label, { color }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  navigation: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "stretch",
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  pressedItem: {
    opacity: 0.68,
  },
  label: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
