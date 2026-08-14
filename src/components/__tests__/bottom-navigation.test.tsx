// The real `SafeAreaProvider` only renders children after a native `onInsetsChange` event, which
// never fires under Jest. Swap in the package's own documented test mock, which provides insets
// synchronously — the same approach `course.test.tsx` takes.
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { BottomNavigation } from "../bottom-navigation";

const mockReplace = jest.fn();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

jest.mock("expo-router", () => ({
  // Behaves like an ordinary mount effect rather than a no-op, so the focus-driven reloads these
  // screens use are actually exercised instead of silently skipped.
  useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]),
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

describe("BottomNavigation", () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it("navigates to the shader library", async () => {
    await render(<BottomNavigation activeItem="home" />);

    await fireEvent.press(screen.getByText("Editor"));

    expect(mockReplace).toHaveBeenCalledWith("/library");
  });

  it("navigates to home", async () => {
    await render(<BottomNavigation activeItem="editor" />);

    await fireEvent.press(screen.getByText("Home"));

    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("navigates to the course", async () => {
    await render(<BottomNavigation activeItem="editor" />);

    await fireEvent.press(screen.getByText("Course"));

    expect(mockReplace).toHaveBeenCalledWith("/course");
  });

  it("awaits the pre-navigation hook before changing tabs", async () => {
    const save = deferred();
    const onBeforeNavigate = jest.fn(() => save.promise.then(() => true));
    await render(
      <BottomNavigation activeItem="editor" onBeforeNavigate={onBeforeNavigate} />,
    );

    await fireEvent.press(screen.getByText("Home"));

    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve();
      await save.promise;
    });

    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("does not navigate when the active tab is pressed", async () => {
    await render(<BottomNavigation activeItem="editor" />);

    await fireEvent.press(screen.getByText("Editor"));

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
