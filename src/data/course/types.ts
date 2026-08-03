import type { ShaderPreviewKey } from "../../shaders/preview-registry";

export type ModuleStatus = "published" | "planned";

export type LessonPreset = {
  id: string;
  position: number;
  label: string;
  previewKey: ShaderPreviewKey;
  previewParameters: Record<string, boolean | number | string>;
  value: string;
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
