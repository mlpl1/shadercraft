import type { ProgressMutation } from "../../progress/progress-repository";
import { ProgressRemoteError } from "../progress-remote";
import {
  PULL_PAGE_SIZE,
  SupabaseProgressRemote,
  type SupabaseProgressClientLike,
} from "../supabase-progress-remote";

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
  const client: SupabaseProgressClientLike = {
    rpc,
    from: chain.from as unknown as SupabaseProgressClientLike["from"],
  };
  return { client, rpc, ...chain };
}

describe("SupabaseProgressRemote.applyMutation", () => {
  it("calls the RPC with exact snake-case parameters", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(rpcRow());
    const remote = new SupabaseProgressRemote(client);

    await remote.applyMutation(MUTATION);

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

    await expect(remote.applyMutation(MUTATION)).resolves.toEqual({
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
    await expect(remote.applyMutation(MUTATION)).resolves.toEqual({
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

    const first = await remote.applyMutation(MUTATION);
    const second = await remote.applyMutation(MUTATION);

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

    await expect(remote.applyMutation(MUTATION)).rejects.toMatchObject({
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

    await expect(remote.applyMutation(MUTATION)).rejects.toMatchObject({ kind: "transport" });
  });

  it("classifies an expired session as an authentication error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "JWT expired", code: "PGRST301" },
      status: 401,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION)).rejects.toMatchObject({ kind: "auth" });
  });

  it("classifies a permission rejection as permanent, not transport or auth", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table lesson_progress", code: "42501" },
      status: 403,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a response with zero rows as a protocol error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({ data: [], error: null, status: 200 });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a response with more than one row as a protocol error", async () => {
    const { client, rpc } = createClientMock();
    const twoRows = rpcRow();
    twoRows.data.push({ ...twoRows.data[0] });
    rpc.mockResolvedValue(twoRows);
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a non-integer revision as a protocol error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(rpcRow({ revision: 1.5 }));
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a row reporting both applied and conflict as a protocol error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(rpcRow({ applied: true, conflict: true }));
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a row reporting neither applied nor conflict as a protocol error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue(rpcRow({ applied: false, conflict: false }));
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.applyMutation(MUTATION)).rejects.toMatchObject({ kind: "rejected" });
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

    await remote.pullAfter(41, 10);

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

    await expect(remote.pullAfter(0, 200)).resolves.toEqual([]);
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

    await expect(remote.pullAfter(0, 200)).resolves.toEqual([
      { lessonId: "a", completed: true, revision: 1, changeId: 1 },
      { lessonId: "b", completed: false, revision: 3, changeId: 2 },
    ]);
  });

  it("caps a single request's page size at PULL_PAGE_SIZE even when the caller asks for more", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({ data: [], error: null, status: 200 });
    const remote = new SupabaseProgressRemote(client);

    await remote.pullAfter(0, PULL_PAGE_SIZE * 5);

    expect(limit).toHaveBeenCalledWith(PULL_PAGE_SIZE);
  });

  it("fetches a second page, cursoring from the last row of the first, for a multi-page pull", async () => {
    const { client, gt, limit } = createClientMock();
    const firstPage = Array.from({ length: PULL_PAGE_SIZE }, (_, i) =>
      changeRow({ lesson_id: `lesson-${i}`, change_id: i + 1 }),
    );
    const secondPage = [changeRow({ lesson_id: "last", change_id: PULL_PAGE_SIZE + 1 })];
    limit
      .mockResolvedValueOnce({ data: firstPage, error: null, status: 200 })
      .mockResolvedValueOnce({ data: secondPage, error: null, status: 200 });
    const remote = new SupabaseProgressRemote(client);

    const result = await remote.pullAfter(0, PULL_PAGE_SIZE + 1);

    expect(result).toHaveLength(PULL_PAGE_SIZE + 1);
    expect(result[result.length - 1]).toEqual({
      lessonId: "last",
      completed: true,
      revision: 1,
      changeId: PULL_PAGE_SIZE + 1,
    });
    expect(limit).toHaveBeenCalledTimes(2);
    expect(gt).toHaveBeenNthCalledWith(1, "change_id", 0);
    expect(gt).toHaveBeenNthCalledWith(2, "change_id", PULL_PAGE_SIZE);
  });

  it("stops paging once a page comes back shorter than requested", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValueOnce({
      data: [changeRow({ change_id: 1 })],
      error: null,
      status: 200,
    });
    const remote = new SupabaseProgressRemote(client);

    await remote.pullAfter(0, PULL_PAGE_SIZE * 3);

    // A page shorter than requested means the server is caught up; a second request would be wasted.
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it("rejects the whole pull, advancing nothing, when a row is missing its lesson id", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({
      data: [changeRow({ change_id: 1 }), changeRow({ lesson_id: null, change_id: 2 })],
      error: null,
      status: 200,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.pullAfter(0, 200)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects a page containing a non-integer revision", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({ data: [changeRow({ revision: 2.2 })], error: null, status: 200 });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.pullAfter(0, 200)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("classifies a network failure during a pull as a retryable transport error", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({ data: null, error: { message: "network error", code: "" }, status: 0 });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.pullAfter(0, 200)).rejects.toMatchObject({ kind: "transport" });
  });

  it("classifies an expired session during a pull as an authentication error", async () => {
    const { client, limit } = createClientMock();
    limit.mockResolvedValue({
      data: null,
      error: { message: "JWT expired", code: "PGRST301" },
      status: 401,
    });
    const remote = new SupabaseProgressRemote(client);

    await expect(remote.pullAfter(0, 200)).rejects.toMatchObject({ kind: "auth" });
  });
});
