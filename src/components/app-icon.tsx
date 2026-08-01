import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { Text, type StyleProp, type TextStyle } from "react-native";

type AppIconProps = {
  name: SymbolViewProps["name"];
  fallback: string;
  color: string;
  size?: number;
  style?: StyleProp<TextStyle>;
};

export function AppIcon({
  name,
  fallback,
  color,
  size = 24,
  style,
}: AppIconProps) {
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color}
      fallback={
        <Text style={[{ color, fontSize: size, lineHeight: size }, style]}>
          {fallback}
        </Text>
      }
    />
  );
}
