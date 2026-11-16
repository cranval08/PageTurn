import { create } from "zustand";
import { AuthError, ensureToken, hasValidToken, invalidateToken, requestToken, setLoginHint, signOutGoogle } from "../lib/google/auth";
import { getUserInfo, type GoogleUser } from "../lib/google/drive";

export type AuthStatus = "signed-out" | "signing-in" | "signed-in" | "expired";

interface AuthState {
  status: AuthStatus;
  user: GoogleUser | null;
  /** Last sign-in problem to show the user, if any. */
  error: string | null;
  clearError(): void;
  /** DRV-1. Call from a click. */
  signIn(): Promise<void>;
  /** DRV-1. */
  signOut(): Promise<void>;
  /**
   * DRV-4: a token for a Drive action. Signs in if needed, refreshes silently if
   * expired; if that fails, status becomes "expired" and the error is rethrown.
   * Synchronous until the popup opens, so call from a click.
   */
  driveToken(): Promise<string>;
  /** Drive said 401: forget the token and ask to sign in again. */
  markExpired(): void;
}

export const useAuth = create<AuthState>((set, get) => {
  const fail = (err: unknown, expiredOnFailure: boolean): never => {
    const message = err instanceof Error ? err.message : "Google sign-in didn't work. Try again.";
    set({ error: message, status: expiredOnFailure ? "expired" : get().user ? get().status : "signed-out" });
    throw err;
  };

  const completeSignIn = async (token: string) => {
    const user = await getUserInfo(token);
    setLoginHint(user.email);
    set({ status: "signed-in", user, error: null });
    return token;
  };

  return {
    status: "signed-out",
    user: null,
    error: null,
    clearError: () => set({ error: null }),

    signIn() {
      const tokenPromise = requestToken(); // sync: keep inside the click
      set({ status: "signing-in", error: null });
      return tokenPromise.then(completeSignIn).then(
        () => undefined,
        (err) => fail(err, false),
      );
    },

    async signOut() {
      await signOutGoogle();
      set({ status: "signed-out", user: null, error: null });
    },

    driveToken() {
      const { status } = get();
      if (status === "signed-in" && hasValidToken()) return ensureToken();
      const wasSignedIn = status === "signed-in" || status === "expired";
      const tokenPromise = ensureToken(); // sync: keep inside the click
      if (!wasSignedIn) set({ status: "signing-in", error: null });
      return tokenPromise.then(
        (token) => (wasSignedIn ? (set({ status: "signed-in", error: null }), token) : completeSignIn(token)),
        (err) => fail(err, wasSignedIn && err instanceof AuthError),
      );
    },

    markExpired() {
      invalidateToken();
      if (get().user) set({ status: "expired" });
    },
  };
});
