import { fireEvent, render, screen } from "@testing-library/react-native";

import { CourseModuleCard } from "../course-module-card";

describe("CourseModuleCard", () => {
  test("renders a press target for a fully complete module and labels it 'Review lesson'", async () => {
    // Regression coverage for the currentLessonIndex=-1 bug: a complete module must still expose
    // exactly one tappable "current" row (its last lesson) so the card is never tap-dead.
    const topics = ["Coordinates", "UV space", "Aspect ratio"];
    const onPress = jest.fn();

    await render(
      <CourseModuleCard
        completedLessonCount={3}
        currentLessonIndex={2}
        description="A completed module"
        lessonCount={3}
        moduleNumber={1}
        onPress={onPress}
        status="complete"
        title="Coordinate systems"
        topics={topics}
      />,
    );

    const continueButton = screen.getByRole("button", { name: "Continue Aspect ratio" });
    expect(continueButton).toBeTruthy();
    expect(screen.getByText("Review lesson")).toBeTruthy();

    fireEvent.press(continueButton);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("renders no press target when currentLessonIndex points nowhere (the pre-fix regression)", async () => {
    // Documents the exact failure mode Fix 1 closes: when currentLessonIndex is -1 (what
    // buildModuleViewModel used to return for a fully complete module), no topic row matches
    // `index === currentLessonIndex`, so the card renders zero Pressables and is tap-dead.
    await render(
      <CourseModuleCard
        completedLessonCount={3}
        currentLessonIndex={-1}
        description="A completed module"
        lessonCount={3}
        moduleNumber={1}
        onPress={jest.fn()}
        status="complete"
        title="Coordinate systems"
        topics={["Coordinates", "UV space", "Aspect ratio"]}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });
});
