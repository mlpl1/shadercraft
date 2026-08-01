import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "./app-icon";
import { Colors, Spacing } from "../constants/theme";

type BottomNavigationProps = {
  onUnavailable: (destination: string) => void;
};

const items = [
  {
    label: "Home",
    active: true,
    icon: { android: "home", ios: "house.fill", web: "home" } as const,
    fallback: "⌂",
  },
  {
    label: "Course",
    active: false,
    icon: { android: "book_2", ios: "book.fill", web: "book_2" } as const,
    fallback: "▤",
  },
  {
    label: "Editor",
    active: false,
    icon: { android: "code", ios: "chevron.left.forwardslash.chevron.right", web: "code" } as const,
    fallback: "</>",
  },
];

export function BottomNavigation({ onUnavailable }: BottomNavigationProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.shell, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.navigation}>
        {items.map((item) => {
          const color = item.active ? Colors.accent : Colors.textMuted;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: item.active }}
              key={item.label}
              onPress={() => !item.active && onUnavailable(item.label)}
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
    paddingHorizontal: Spacing.xxl,
  },
  navigation: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    flexDirection: "row",
    justifyContent: "space-around",
  },
  item: {
    minWidth: 72,
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
