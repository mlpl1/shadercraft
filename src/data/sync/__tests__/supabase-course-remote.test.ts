import { SupabaseCourseRemote, type SupabaseCourseClientLike } from "../supabase-course-remote";

/** A minimal payload that satisfies `parseCourseRelease` with zero modules. */
const VALID_PAYLOAD = {
  id: "release-1",
  schemaVersion: 1,
  minimumAppVersion: "1.0.0",
  checksum: "a".repeat(64),
  modules: [],
};

const VALID_MANIFEST_ROW = {
  id: "release-1",
  schema_version: 1,
  minimum_app_version: "1.0.0",
  checksum: "a".repeat(64),
  published_at: "2026-08-01T00:00:00.000Z",
};

function createClientMock() {
  const rpc = jest.fn();
  const client: SupabaseCourseClientLike = {
    rpc: rpc as unknown as SupabaseCourseClientLike["rpc"],
  };
  return { client, rpc };
}

describe("SupabaseCourseRemote.getActiveManifest", () => {
  it("maps a single valid manifest row to a camelCase manifest", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({ data: [VALID_MANIFEST_ROW], error: null, status: 200 });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getActiveManifest()).resolves.toEqual({
      id: "release-1",
      schemaVersion: 1,
      minimumAppVersion: "1.0.0",
      checksum: "a".repeat(64),
      publishedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith("get_active_course_manifest", {});
  });

  it("returns null when there is no active release", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({ data: [], error: null, status: 200 });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getActiveManifest()).resolves.toBeNull();
  });

  it("rejects a response with more than one active manifest row as a protocol failure", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({ data: [VALID_MANIFEST_ROW, VALID_MANIFEST_ROW], error: null, status: 200 });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getActiveManifest()).rejects.toThrow();
  });

  it("rejects a manifest row with a malformed checksum", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: [{ ...VALID_MANIFEST_ROW, checksum: "not-hex" }],
      error: null,
      status: 200,
    });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getActiveManifest()).rejects.toThrow();
  });

  it("rejects a manifest row with a malformed minimum app version", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: [{ ...VALID_MANIFEST_ROW, minimum_app_version: "v1" }],
      error: null,
      status: 200,
    });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getActiveManifest()).rejects.toThrow();
  });

  it("rejects a manifest row with a non-integer schema version", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: [{ ...VALID_MANIFEST_ROW, schema_version: 1.5 }],
      error: null,
      status: 200,
    });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getActiveManifest()).rejects.toThrow();
  });

  it("throws when Supabase reports an error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "upstream connect error", code: "" },
      status: 503,
    });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getActiveManifest()).rejects.toThrow(/upstream connect error/);
  });

  it("rejects a non-array response as a protocol failure", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({ data: null, error: null, status: 200 });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getActiveManifest()).rejects.toThrow(/non-array response/);
  });
});

describe("SupabaseCourseRemote.getRelease", () => {
  it("returns the validated payload for a valid release id", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({ data: VALID_PAYLOAD, error: null, status: 200 });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getRelease("release-1")).resolves.toEqual(VALID_PAYLOAD);
    expect(rpc).toHaveBeenCalledWith("get_course_release", { p_release_id: "release-1" });
  });

  it("rejects when the RPC returns no payload for the requested id", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({ data: null, error: null, status: 200 });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getRelease("missing-release")).rejects.toThrow(/returned no payload/);
  });

  it("rejects a payload that fails schema validation", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: { ...VALID_PAYLOAD, schemaVersion: 999 },
      error: null,
      status: 200,
    });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getRelease("release-1")).rejects.toThrow(/schemaVersion/);
  });

  it("throws when Supabase reports an error", async () => {
    const { client, rpc } = createClientMock();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied", code: "42501" },
      status: 403,
    });
    const remote = new SupabaseCourseRemote(client);

    await expect(remote.getRelease("release-1")).rejects.toThrow(/permission denied/);
  });
});
