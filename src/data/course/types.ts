import type { ShaderPreviewKey } from "../../shaders/preview-registry";

export type ModuleStatus = "published" | "planned";

export type LessonPreset = {
  id: string;
  position: number;
  label: string;
  previewKey: ShaderPreviewKey;
  previewParameters: Record<string, boolean | number | string>;
  value: string;
  /**
   * Overrides the preview footer's value line when present, falling back to the default
   * `label · value` composition when absent. Lets a preset author bespoke footer copy without
   * changing `value`, which is also rendered on the preset's own chip.
   */
  previewValueLabel?: string;
  filename: string;
  codeLines: string[];
  highlightedLines: number[];
};

export type CourseLesson = {
  id: string;
  moduleId: string;
  position: number;
  title: string;
  shortTitle: string;
  intro: string;
  conceptTitle: string;
  conceptLede: string;
  tryHint: string;
  takeaway: string;
  /** Footer caption for the live preview, authored per lesson. */
  previewCaption: string;
  /** Preset the lesson opens on; the lowest-positioned preset when absent. */
  defaultPresetId?: string;
  /** Overrides the lesson intro's eyebrow label; falls back to "Concept" when absent. */
  introEyebrow?: string;
  presets: LessonPreset[];
  sections: { id: string; position: number; title: string; body: string }[];
};

export type CourseModule = {
  id: string;
  position: number;
  status: ModuleStatus;
  title: string;
  description: string;
  plannedLessonCount: number;
  plannedTopics: string[];
  lessons: CourseLesson[];
};

export type CourseRelease = {
  id: string;
  schemaVersion: 1;
  minimumAppVersion: string;
  checksum: string;
  modules: CourseModule[];
};
