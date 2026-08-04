import type { ProgressMutation } from "../../progress/progress-repository";
import { ProgressRemoteError } from "../progress-remote";
import {
  PULL_PAGE_SIZE,
  SupabaseProgressRemote,
  type SupabaseProgressClientLike,
} from "../supabase-progress-remote";

/** The account every mutation and pull below belongs to. */
const USER_ID = "11111111-2222-3333-4444-555555555555";

const MUTATION: ProgressMutation = {
  profileId: "profile-1",
  mutationId: "11111111-1111-1111-1111-111111111111",
  lessonId: "coordinate-systems-uv-space",
  completed: true,
  baseRevision: 0,
  attempts: 0,
  createdAt: "2026-08-04T00:00:00.000Z",
};

/** A `.rpc()` response carrying exactly one `apply_progress_mutation` row. */
function rpcRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: [
      {
        applied: true,
        conflict: false,
        completed: true,
        revision: 1,
        change_id: 100,
        ...overrides,
      },
    ],
    error: null,
    status: 200,
  };
}

/** A minimal mock of the `.from().select().gt().order().limit()` chain, one call recorded per link. */
function createChainMock() {
  const limit = jest.fn();
  const order = jest.fn().mockReturnValue({ limit });
  const gt = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ gt });
  const from = jest.fn().mockReturnValue({ select });
  return { from, select, gt, order, limit };
}

function createClientMock() {
  const rpc = jest.fn();
  const chain = createChainMock();
  // The session the client would authenticate the next request with. Defaults to the account every
  // call below claims to be acting as, so only the identity tests have to think about it.
  const getSession = jest.fn().mockResolvedValue({
    data: { session: { user: { id: USER_ID } } },
    error: null,
  });
  const client: SupabaseProgressClientLike = {
    auth: { getSession },
    rpc,
    from: chain.from as unknown as SupabaseProgressClientLike["from"],
  };
  return { client, rpc, getSession, ...chain };
}

describe("SupabaseProgressRemote.applyMutation", () => {
  it("calls the RPC with exact snake-case parameters", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(rpcRow());
    const remote = new SupabaseProgressRemote(client);

    await remote.applyMutation(MUTATION, USER_ID);

    expect(rpc).toHaveBeenCalledWith("apply_progress_mutation", {
      p_mutation_id: MUTATION.mutationId,
      p_lesson_id: MUTATION.lessonId,
      p_completed: MUTATION.completed,
      p_base_revision: MUTATION.baseRevision,
    });
  });

  it("maps an applied row to an applied result", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(rpcRow({ applied: true, conflict: false, completed: true, revision: 1, change_id: 42 }));
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).resolves.toEqual({
      kind: "applied",
      completed: true,
      revision: 1,
      changeId: 42,
    });
  });

  it("maps a conflict row to a conflict result without throwing", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(
      rpcRow({ applied: false, conflict: true, completed: false, revision: 5, change_id: 90 }),
    );
    const remote = new SupabaseProgressRemote(client);

    // A conflict is a normal outcome, not an error: it must resolve, not reject.
    await expect(remote.applyMutation(MUTATION, USER_ID)).resolves.toEqual({
      kind: "conflict",
      completed: false,
      revision: 5,
      changeId: 90,
    });
  });

  it("returns the same recorded outcome when a mutation id is replayed", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(rpcRow({ applied: true, conflict: false, completed: true, revision: 1, change_id: 7 }));
    const remote = new SupabaseProgressRemote(client);

    const first = await remote.applyMutation(MUTATION, USER_ID);
    const second = await remote.applyMutation(MUTATION, USER_ID);

    expect(first).toEqual(second);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("classifies a network failure as a retryable transport error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "TypeError: Failed to fetch", code: "" },
      status: 0,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({
      kind: "transport",
    } satisfies Partial<ProgressRemoteError>);
  });

  it("classifies a server error as a retryable transport error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "upstream connect error", code: "" },
      status: 503,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({ kind: "transport" });
  });

  it("classifies an expired session as an authentication error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "JWT expired", code: "PGRST301" },
      status: 401,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({ kind: "auth" });
  });

  it("classifies a permission rejection as permanent, not transport or auth", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table lesson_progress", code: "42501" },
      status: 403,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a response with zero rows as a protocol error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({ data: [], error: null, status: 200 });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a response with more than one row as a protocol error", async () => {
    const { client, rpc } = createClientMock();
    const twoRows = rpcRow();
    twoRows.data.push({ ...twoRows.data[0] });
    rpc.mockResolvedValue(twoRows);
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a non-integer revision as a protocol error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(rpcRow({ revision: 1.5 }));
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a row reporting both applied and conflict as a protocol error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(rpcRow({ applied: true, conflict: true }));
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a row reporting neither applied nor conflict as a protocol error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(rpcRow({ applied: false, conflict: false }));
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({ kind: "rejected" });
  });
});

describe("SupabaseProgressRemote.pullAfter", () => {
  /** A row shaped like a `lesson_progress` select result. */
  function changeRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      lesson_id: "coordinate-systems-uv-space",
      completed: true,
      revision: 1,
      change_id: 1,
      ...overrides,
    };
  }

  it("queries in ascending change_id order after the given cursor", async () => {
    const { client, from, select, gt, order, limit } = createClientMock();
    limit.mockResolvedValue({ data: [], error: null, status: 200 });
    const remote = new SupabaseProgressRemote(client);

    await remote.pullAfter(41, 10, USER_ID);

    expect(from).toHaveBeenCalledWith("lesson_progress");
    expect(select).toHaveBeenCalledWith("lesson_id, completed, revision, change_id");
    expect(gt).toHaveBeenCalledWith("change_id", 41);
    expect(order).toHaveBeenCalledWith("change_id", { ascending: true });
    expect(limit).toHaveBeenCalledWith(10);
  });

  it("returns an empty array when there is nothing new to pull", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({ data: [], error: null, status: 200 });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.pullAfter(0, 200, USER_ID)).resolves.toEqual([]);
  });

  it("maps a single page of rows to remote progress changes", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({
      data: [
        changeRow({ lesson_id: "a", completed: true, revision: 1, change_id: 1 }),
        changeRow({ lesson_id: "b", completed: false, revision: 3, change_id: 2 }),
      ],
      error: null,
      status: 200,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.pullAfter(0, 200, USER_ID)).resolves.toEqual([
      { lessonId: "a", completed: true, revision: 1, changeId: 1 },
      { lessonId: "b", completed: false, revision: 3, changeId: 2 },
    ]);
  });

  it("caps a single request's page size at PULL_PAGE_SIZE even when the caller asks for more", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({ data: [], error: null, status: 200 });
    const remote = new SupabaseProgressRemote(client);

    await remote.pullAfter(0, PULL_PAGE_SIZE * 5, USER_ID);

    expect(limit).toHaveBeenCalledWith(PULL_PAGE_SIZE);
  });

  it("issues exactly one request per call, leaving pagination to the caller", async () => {
    const { client, gt, limit } = createClientMock();
    const fullPage = Array.from({ length: PULL_PAGE_SIZE }, (_, i) =>
      changeRow({ lesson_id: `lesson-${i}`, change_id: i + 1 }),
    );
    limit.mockResolvedValue({ data: fullPage, error: null, status: 200 });
    const remote = new SupabaseProgressRemote(client);

    // A full page is exactly the case a paging loop here would follow up on. It must not: the engine
    // owns pagination, and derives its next cursor with `Math.max` over the batch rather than trusting
    // the response's order the way a loop here would have to.
    const result = await remote.pullAfter(0, PULL_PAGE_SIZE * 3, USER_ID);

    expect(result).toHaveLength(PULL_PAGE_SIZE);
    expect(limit).toHaveBeenCalledTimes(1);
    expect(gt).toHaveBeenCalledTimes(1);
    expect(gt).toHaveBeenCalledWith("change_id", 0);
  });

  it("rejects the whole pull, advancing nothing, when a row is missing its lesson id", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({
      data: [changeRow({ change_id: 1 }), changeRow({ lesson_id: null, change_id: 2 })],
      error: null,
      status: 200,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.pullAfter(0, 200, USER_ID)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a page containing a non-integer revision", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({ data: [changeRow({ revision: 2.2 })], error: null, status: 200 });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.pullAfter(0, 200, USER_ID)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("classifies a network failure during a pull as a retryable transport error", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({ data: null, error: { message: "network error", code: "" }, status: 0 });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.pullAfter(0, 200, USER_ID)).rejects.toMatchObject({ kind: "transport" });
  });

  it("classifies an expired session during a pull as an authentication error", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({
      data: null,
      error: { message: "JWT expired", code: "PGRST301" },
      status: 401,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.pullAfter(0, 200, USER_ID)).rejects.toMatchObject({ kind: "auth" });
  });
});

/**
 * The check that keeps a sync pass scoped to the account it started for. The client is a singleton
 * carrying whichever session is current at request time, so without this a pass whose learner switched
 * accounts mid-flight would keep sending — and the server would accept every request as the *new*
 * account's own work.
 */
describe("SupabaseProgressRemote session identity", () => {
  it("refuses to send a mutation once the client's session belongs to another account", async () => {
    const { client, rpc, getSession } = createClientMock();
    rpc.mockResolvedValue(rpcRow());
    getSession.mockResolvedValue({
      data: { session: { user: { id: "99999999-9999-9999-9999-999999999999" } } },
      error: null,
    });
    const remote = new SupabaseProgressRemote(client);

    // `auth`, not `rejected`: the engine leaves the outbox untouched and the scheduler pauses, so the
    // mutation is still there to send once the session and the profile agree again.
    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({ kind: "auth" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses to pull once the client's session belongs to another account", async () => {
    const { client, from, getSession } = createClientMock();
    getSession.mockResolvedValue({
      data: { session: { user: { id: "99999999-9999-9999-9999-999999999999" } } },
      error: null,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.pullAfter(0, 200, USER_ID)).rejects.toMatchObject({ kind: "auth" });
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses to send anything when no session is active at all", async () => {
    const { client, rpc, getSession } = createClientMock();
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({ kind: "auth" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats a failure to read the session as an auth failure rather than proceeding", async () => {
    const { client, rpc, getSession } = createClientMock();
    getSession.mockResolvedValue({
      data: { session: null },
      error: { message: "could not read the stored session" },
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).rejects.toMatchObject({ kind: "auth" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends normally when the session matches the account the request belongs to", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(rpcRow());
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION, USER_ID)).resolves.toMatchObject({
      kind: "applied",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
