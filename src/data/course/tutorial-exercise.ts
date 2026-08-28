import type { TutorialChoice, TutorialStep } from "./types";

export const SHADERCRAFT_BLANK = "/*__SHADERCRAFT_BLANK__*/";

export function fillTutorialTemplate(template: string, fragment: string): string {
  return template.replace(SHADERCRAFT_BLANK, fragment);
}

export function getCorrectTutorialSource(step: TutorialStep): string {
  const choice = step.answerChoices.find(({ id }) => id === step.correctChoiceId);
  if (!choice) throw new Error(`Tutorial step ${step.id} has no correct choice`);
  return fillTutorialTemplate(step.sourceTemplate, choice.fragment);
}

export function shuffleTutorialChoices(
  choices: readonly TutorialChoice[],
  random: () => number = Math.random,
): TutorialChoice[] {
  const shuffled = [...choices];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}
