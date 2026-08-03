# Shadercraft

Shadercraft is a mobile-first, interactive course for learning fragment shaders. Lessons
combine concise explanations, live OpenGL previews, GLSL source, and small experiments so
learners can see coordinate and rendering concepts change in real time.

The project is currently an early working prototype built with Expo and React Native.

## Current features

- Home dashboard and four-module curriculum browser
- Complete Module 01, Module 02, and Module 03 learning paths with sequential unlocking
- Interactive lessons spanning UV coordinates, time, transforms, distance fields, color mixing, luma, procedural palettes, and lighting
- Live `expo-gl` fragment shader with animated output
- Normalized and centered UV experiments that update both preview and GLSL source
- Persistent lesson completion and course progress
- Module unlocking derived from the shared progress state
- Reversible completion for accidentally completed lessons
- Guided completion summary with review and course-navigation actions

Modules 01 and 02 each contain five interactive lessons; Module 03 contains four. Every module
concludes with a layered shader challenge. Completing Shape Synthesis unlocks Color & Light, and
finishing its lighting challenge unlocks Module 04, Procedural Textures.

## Technology

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- React Native 0.86 and React 19.2
- [Expo Router](https://docs.expo.dev/versions/v57.0.0/sdk/router/) for file-based navigation
- [Expo GLView](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view/) for live shader rendering
- AsyncStorage for local progress persistence
- TypeScript and the React Compiler

## Requirements

- Node.js 22.13 or newer
- npm
- Android Studio with an Android emulator, or a connected Android device
- A configured Android SDK and Java environment for native builds

Expo SDK 57 supports Android 7 and newer. iOS and web are configured, but current development
and device verification have focused on Android.

## Getting started

Install dependencies:

```bash
npm install
```

Build and launch the Android development client:

```bash
npm run android
```

For subsequent JavaScript and styling changes, start Metro and reopen the installed client:

```bash
npm run start
```

When a native dependency changes, run `npm run android` again so the package is included in
the installed application.

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run start` | Start the Expo development server |
| `npm run android` | Build and run the native Android application |
| `npm run ios` | Build and run the native iOS application |
| `npm run web` | Start the web version |
| `npx tsc --noEmit` | Run the TypeScript check without emitting files |

## Project structure

```text
src/
├── app/          Expo Router screens and root layout
├── components/   Navigation, course, lesson, and shader UI
├── constants/    Shared visual theme
├── context/      Application-wide progress state
└── lib/          Progress persistence and curriculum helpers
```

The Android native project is stored in `android/`. Static images and app icons are stored in
`assets/`.

## Progress behavior

Lesson completion is stored locally on the device. Completing a lesson updates Home and Course
immediately and unlocks the next lesson in its module. Module 02 becomes available only after all
five foundation lessons are complete, Module 03 unlocks after all five Shape Synthesis lessons, and
Module 04 unlocks after all four Color & Light lessons.
A completed lesson can be marked incomplete after confirmation without deleting completion
records for later lessons.

Progress does not currently sync between devices or GitHub accounts.

## Roadmap

- Editable GLSL with debounced shader recompilation and compiler feedback
- Automated tests and configured linting
- Optional cloud progress synchronization

## Contributing

Issues and focused pull requests are welcome while the curriculum and interaction model are
still evolving. Before submitting a change, run:

```bash
npx tsc --noEmit
```
