import { createDisabledAuthService } from "../auth-service";
import { SupabaseAuthService, type SupabaseAuthLike } from "../supabase-auth-service";

type AuthMock = {
  [K in keyof SupabaseAuthLike]: jest.Mock;
};

function createAuthMock(): AuthMock {
  return {
    getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: jest.fn().mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    }),
    signUp: jest.fn().mockResolvedValue({ data: { session: null, user: null }, error: null }),
    signInWithPassword: jest
      .fn()
      .mockResolvedValue({ data: { session: null, user: null }, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
  };
}

const SESSION = {
  user: { id: "user-1", email: "learner@example.com" },
  access_token: "secret-access-token",
  refresh_token: "secret-refresh-token",
};

describe("SupabaseAuthService", () => {
  let auth: AuthMock;
  let service: SupabaseAuthService;

  beforeEach(() => {
    auth = createAuthMock();
    service = new SupabaseAuthService(auth as unknown as SupabaseAuthLike);
  });

  it("passes credentials straight through when signing up", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: SESSION, user: SESSION.user },
      error: null,
    });

    await service.signUpWithPassword("learner@example.com", "correct horse battery staple");

    expect(auth.signUp).toHaveBeenCalledWith({
      email: "learner@example.com",
      password: "correct horse battery staple",
    });
  });

  it("reports a sign-up that returned a session as signed in", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: SESSION, user: SESSION.user },
      error: null,
    });

    await expect(service.signUpWithPassword("learner@example.com", "pw")).resolves.toEqual({
      kind: "signed-in",
    });
  });

  it("reports a sign-up without a session as awaiting email confirmation", async () => {
    // Supabase returns no session when confirmations are on. That is a successful sign-up needing a
    // further step, not a failure, and the account screen has to be able to say so.
    auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: "user-1", email: "learner@example.com" } },
      error: null,
    });

    await expect(service.signUpWithPassword("learner@example.com", "pw")).resolves.toEqual({
      kind: "confirm-email",
      email: "learner@example.com",
    });
  });

  it("signs in and out through the underlying client", async () => {
    await service.signInWithPassword("learner@example.com", "pw");
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "learner@example.com",
      password: "pw",
    });

    await service.signOut();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("restores an existing session as a user id and email, and nothing else", async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });

    const session = await service.getSession();

    expect(session).toEqual({ userId: "user-1", email: "learner@example.com" });
    // No token material may cross this boundary.
    expect(Object.keys(session ?? {}).sort()).toEqual(["email", "userId"]);
  });

  it("reports no session when the client has none", async () => {
    await expect(service.getSession()).resolves.toBeNull();
  });

  it("forwards auth state changes and stops after unsubscribing", () => {
    const unsubscribe = jest.fn();
    let emit: ((event: string, session: unknown) => void) | undefined;
    auth.onAuthStateChange.mockImplementation((callback: typeof emit) => {
      emit = callback;
      return { data: { subscription: { unsubscribe } } };
    });

    const listener = jest.fn();
    const stop = service.subscribe(listener);

    emit?.("SIGNED_IN", SESSION);
    expect(listener).toHaveBeenCalledWith({ userId: "user-1", email: "learner@example.com" });

    emit?.("SIGNED_OUT", null);
    expect(listener).toHaveBeenLastCalledWith(null);

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("surfaces a readable error without leaking token material", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Invalid login credentials" },
    });

    await expect(service.signInWithPassword("learner@example.com", "wrong")).rejects.toThrow(
      "Invalid login credentials",
    );
  });

  it("does not treat a missing email on a confirmed sign-up as a crash", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: "user-1", email: undefined } },
      error: null,
    });

    await expect(service.signUpWithPassword("typed@example.com", "pw")).resolves.toEqual({
      kind: "confirm-email",
      email: "typed@example.com",
    });
  });
});

describe("disabled auth service", () => {
  it("reports no session and no-ops its subscription so local use is unaffected", async () => {
    const service = createDisabledAuthService();
    const listener = jest.fn();

    await expect(service.getSession()).resolves.toBeNull();
    const stop = service.subscribe(listener);
    stop();

    expect(listener).not.toHaveBeenCalled();
  });

  it("explains itself rather than failing obscurely when an account action is attempted", async () => {
    const service = createDisabledAuthService();

    await expect(service.signInWithPassword("a@b.c", "pw")).rejects.toThrow(/cloud sync is disabled/i);
    await expect(service.signUpWithPassword("a@b.c", "pw")).rejects.toThrow(/cloud sync is disabled/i);
    await expect(service.signOut()).rejects.toThrow(/cloud sync is disabled/i);
  });
});
