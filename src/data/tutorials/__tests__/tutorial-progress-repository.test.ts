import { migrateDatabase } from "../../database/migrations";
import { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import { SqliteTutorialProgressRepository } from "../tutorial-progress-repository";

const PROFILE = "profile-1";
const OTHER_PROFILE = "profile-2";

describe("SqliteTutorialProgressRepository", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteTutorialProgressRepository;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(":memory:");
    await migrateDatabase(driver);
    for (const id of [PROFILE, OTHER_PROFILE]) {
      await driver.run(
        "INSERT INTO learner_profiles (id, kind, created_at, last_used_at) VALUES (?, ?, ?, ?)",
        [id, "anonymous", "2026-08-08T00:00:00Z", "2026-08-08T00:00:00Z"],
      );
    }
    repository = new SqliteTutorialProgressRepository(driver);
  });

  afterEach(async () => {
    await driver.close();
  });

  it("returns nothing for a step the learner has never opened", async () => {
    await expect(repository.getStates(PROFILE, ["step-1"])).resolves.toEqual(new Map());
  });

  it("keeps a draft and reports it against its step", async () => {
    await repository.saveDraft(PROFILE, "step-1", "fragColor = vec4(1.0);");

    const states = await repository.getStates(PROFILE, ["step-1", "step-2"]);

    expect(states.get("step-1")).toEqual({ draft: "fragColor = vec4(1.0);", completed: false });
    expect(states.has("step-2")).toBe(false);
  });

  it("overwrites a draft rather than accumulating rows", async () => {
    await repository.saveDraft(PROFILE, "step-1", "first");
    await repository.saveDraft(PROFILE, "step-1", "second");

    const states = await repository.getStates(PROFILE, ["step-1"]);

    expect(states.get("step-1")?.draft).toBe("second");
    await expect(
      driver.first<{ count: number }>("SELECT count(*) as count FROM tutorial_step_drafts"),
    ).resolves.toEqual({ count: 1 });
  });

  it("clears a draft so the step reopens on its starter source", async () => {
    await repository.saveDraft(PROFILE, "step-1", "scratch");
    await repository.clearDraft(PROFILE, "step-1");

    expect((await repository.getStates(PROFILE, ["step-1"])).get("step-1")?.draft).toBeUndefined();
  });

  it("tracks completion independently of the draft", async () => {
    // A learner can mark a step done and keep editing, or edit without ever marking it — neither
    // state implies the other.
    await repository.setCompleted(PROFILE, "step-1", true);

    const states = await repository.getStates(PROFILE, ["step-1"]);
    expect(states.get("step-1")).toEqual({ completed: true });

    await repository.saveDraft(PROFILE, "step-1", "still tinkering");
    expect((await repository.getStates(PROFILE, ["step-1"])).get("step-1")).toEqual({
      draft: "still tinkering",
      completed: true,
    });
  });

  it("un-completes a step without losing its draft", async () => {
    await repository.saveDraft(PROFILE, "step-1", "work");
    await repository.setCompleted(PROFILE, "step-1", true);
    await repository.setCompleted(PROFILE, "step-1", false);

    expect((await repository.getStates(PROFILE, ["step-1"])).get("step-1")).toEqual({
      draft: "work",
      completed: false,
    });
  });

  it("partitions drafts and progress by profile", async () => {
    await repository.saveDraft(PROFILE, "step-1", "mine");
    await repository.setCompleted(PROFILE, "step-1", true);

    const other = await repository.getStates(OTHER_PROFILE, ["step-1"]);

    expect(other.size).toBe(0);
    await expect(repository.getCompletedStepIds(OTHER_PROFILE)).resolves.toEqual(new Set());
  });

  it("lists only the steps actually marked done", async () => {
    await repository.setCompleted(PROFILE, "step-1", true);
    await repository.setCompleted(PROFILE, "step-2", true);
    await repository.setCompleted(PROFILE, "step-2", false);

    await expect(repository.getCompletedStepIds(PROFILE)).resolves.toEqual(new Set(["step-1"]));
  });

  it("handles an empty step list without issuing a query", async () => {
    // A tutorial with no steps cannot exist, but a screen can ask before its content has loaded.
    await expect(repository.getStates(PROFILE, [])).resolves.toEqual(new Map());
  });
});
