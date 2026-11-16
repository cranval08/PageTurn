import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/google/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/google/config")>()),
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  isGoogleConfigured: () => true,
}));
vi.mock("../../src/lib/google/scripts", () => ({ loadScript: () => Promise.resolve() }));
vi.mock("../../src/lib/google/drive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/google/drive")>()),
  getUserInfo: vi.fn(async () => ({ name: "Ada Student", email: "ada@example.com" })),
}));

import * as auth from "../../src/lib/google/auth";
import { useAuth } from "../../src/store/auth";

type Mode = "grant" | "popup_blocked" | "popup_closed" | "no_drive_scope";

/** Fake Google Identity Services token client. */
function installFakeGis() {
  const state = {
    config: null as null | google.accounts.oauth2.TokenClientConfig,
    requests: [] as unknown[],
    mode: "grant" as Mode,
    expiresIn: 3600,
    revoked: null as string | null,
  };
  const oauth2 = {
    initTokenClient(config: google.accounts.oauth2.TokenClientConfig) {
      state.config = config;
      return {
        requestAccessToken(o: unknown) {
          state.requests.push(o);
          const n = state.requests.length;
          if (state.mode === "popup_blocked") return config.error_callback?.({ type: "popup_failed_to_open" });
          if (state.mode === "popup_closed") return config.error_callback?.({ type: "popup_closed" });
          const scope = state.mode === "no_drive_scope" ? "openid email profile" : config.scope;
          config.callback({ access_token: `tok${n}`, expires_in: state.expiresIn, scope, token_type: "Bearer" });
        },
      };
    },
    hasGrantedAllScopes: (r: { scope: string }, ...s: string[]) => s.every((x) => r.scope.split(" ").includes(x)),
    revoke: (t: string, done: () => void) => {
      state.revoked = t;
      done();
    },
  };
  (globalThis as unknown as { google: unknown }).google = { accounts: { oauth2 } };
  return state;
}

let gis: ReturnType<typeof installFakeGis>;

beforeEach(async () => {
  auth._resetAuthForTests();
  useAuth.setState({ status: "signed-out", user: null, error: null });
  gis = installFakeGis();
  await auth.initAuth();
});

afterEach(() => vi.useRealTimers());

describe("GIS token client (DRV-1)", () => {
  it("is created with the client id and only the PRD scopes", () => {
    expect(gis.config?.client_id).toBe("test-client.apps.googleusercontent.com");
    expect(gis.config?.scope).toBe("https://www.googleapis.com/auth/drive.file openid email profile");
  });

  it("keeps the token in memory, not localStorage", async () => {
    const token = await auth.requestToken();
    expect(token).toBe("tok1");
    expect(auth.hasValidToken()).toBe(true);
    expect(JSON.stringify({ ...localStorage })).not.toContain("tok1");
  });

  it("explains a blocked popup", async () => {
    gis.mode = "popup_blocked";
    await expect(auth.requestToken()).rejects.toMatchObject({ kind: "popup_blocked" });
  });

  it("rejects a grant without Drive access (granular consent)", async () => {
    gis.mode = "no_drive_scope";
    await expect(auth.requestToken()).rejects.toMatchObject({ kind: "missing_scope" });
    expect(auth.hasValidToken()).toBe(false);
  });
});

describe("token expiry (DRV-4)", () => {
  it("reuses a valid token without a new popup", async () => {
    await auth.requestToken();
    expect(await auth.ensureToken()).toBe("tok1");
    expect(gis.requests).toHaveLength(1);
  });

  it("requests a fresh token once the current one is about to expire", async () => {
    gis.expiresIn = 30; // inside the 60 s refresh window
    await auth.requestToken();
    expect(auth.hasValidToken()).toBe(false);
    gis.expiresIn = 3600;
    expect(await auth.ensureToken()).toBe("tok2");
    expect(gis.requests).toHaveLength(2);
  });

  it("refreshes after Drive reports 401", async () => {
    await auth.requestToken();
    auth.invalidateToken();
    expect(await auth.ensureToken()).toBe("tok2");
  });
});

describe("auth store", () => {
  it("signs in, loads the profile and signs out (revoking the token)", async () => {
    await useAuth.getState().signIn();
    expect(useAuth.getState()).toMatchObject({ status: "signed-in", user: { name: "Ada Student" } });
    await useAuth.getState().signOut();
    expect(gis.revoked).toBe("tok1");
    expect(useAuth.getState()).toMatchObject({ status: "signed-out", user: null });
    expect(auth.hasValidToken()).toBe(false);
  });

  it("marks the session expired when a silent refresh fails, keeping the user", async () => {
    await useAuth.getState().signIn();
    useAuth.getState().markExpired();
    expect(useAuth.getState().status).toBe("expired");
    gis.mode = "popup_closed";
    await expect(useAuth.getState().driveToken()).rejects.toMatchObject({ kind: "popup_closed" });
    expect(useAuth.getState()).toMatchObject({ status: "expired", user: { email: "ada@example.com" } });

    gis.mode = "grant";
    await expect(useAuth.getState().driveToken()).resolves.toBe("tok3"); // request 2 was the closed popup
    expect(useAuth.getState().status).toBe("signed-in");
  });

  it("passes the account email as login_hint on refresh", async () => {
    await useAuth.getState().signIn();
    auth.invalidateToken();
    await useAuth.getState().driveToken();
    expect(gis.requests.at(-1)).toEqual({ prompt: "", login_hint: "ada@example.com" });
  });
});
