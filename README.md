# Shadercraft

Shadercraft is a mobile-first, interactive course for learning fragment shaders. Lessons
combine concise explanations, live OpenGL previews, GLSL source, and small experiments so
learners can see coordinate and rendering concepts change in real time.

The project is currently an early working prototype built with Expo and React Native.

## Current features

- Home dashboard and four-module curriculum browser
- First lesson: **Coordinate Systems & UV Space**
- Live `expo-gl` fragment shader with animated output
- Normalized and centered UV experiments that update both preview and GLSL source
- Persistent lesson completion and course progress
- Module unlocking derived from the shared progress state
- Reversible completion for accidentally completed lessons
- Guided completion summary with review and course-navigation actions

At this stage, completing the implemented lesson unlocks Module 02 as a prototype milestone.
The Shape Synthesis lesson content is not implemented yet.

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

Lesson completion is stored locally on the device. Completing the current lesson updates Home
and Course immediately, advances total progress to 5%, and unlocks Module 02. A completed lesson
can be marked incomplete after confirmation; doing so reverses the progress and unlock state.

Progress does not currently sync between devices or GitHub accounts.

## Roadmap

- Editable GLSL with debounced shader recompilation and compiler feedback
- Module 02: Shape Synthesis
- Complete lesson sequencing within each module
- Automated tests and configured linting
- Optional cloud progress synchronization

## Contributing

Issues and focused pull requests are welcome while the curriculum and interaction model are
still evolving. Before submitting a change, run:

```bash
npx tsc --noEmit
```
