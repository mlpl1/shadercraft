import AsyncStorage from "@react-native-async-storage/async-storage";

export type PreviewMode = "responsive" | "square" | "wide";
export const PREVIEW_MODE_KEY = "@shadercraft/preview-mode";

export async function loadPreviewMode(): Promise<PreviewMode> {
  const value = await AsyncStorage.getItem(PREVIEW_MODE_KEY);
  return value === "square" || value === "wide" ? value : "responsive";
}

export async function savePreviewMode(mode: PreviewMode): Promise<void> {
  await AsyncStorage.setItem(PREVIEW_MODE_KEY, mode);
}
