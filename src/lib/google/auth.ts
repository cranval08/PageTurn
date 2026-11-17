import { APPDATA_SCOPE, DRIVE_FILE_SCOPE, GIS_SCRIPT_URL, GOOGLE_CLIENT_ID, SCOPE_STRING, isGoogleConfigured } from "./config";
import { loadScript } from "./scripts";

export type AuthErrorKind = "not_configured" | "not_ready" | "popup_blocked" | "popup_closed" | "denied" | "missing_scope" | "unknown";

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  constructor(kind: AuthErrorKind, message: string) {
    super(message);
    this.name = "AuthError";
    this.kind = kind;
  }
}

const MESSAGES: Record<AuthErrorKind, string> = {
  not_configured: "Google Drive isn't set up for this copy of PageTurn.",
  not_ready: "Google sign-in is still loading. Try again in a moment.",
  popup_blocked: "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.",
  popup_closed: "The Google sign-in window was closed before finishing.",
  denied: "Google sign-in was cancelled.",
  missing_scope: "PageTurn needs permission to open the files you pick in Drive. Sign in again and tick the Drive box.",
  unknown: "Google sign-in didn't work. Try again.",
};

const authError = (kind: AuthErrorKind) => new AuthError(kind, MESSAGES[kind]);

/** Refresh this long before Google's stated expiry. */
export const EXPIRY_SKEW_MS = 60_000;

interface Token {
  accessToken: string;
  expiresAt: number;
}

// Security NFR: the token lives in memory only, never in localStorage.
let token: Token | null = null;
let client: google.accounts.oauth2.TokenClient | null = null;
let pending: { resolve(t: string): void; reject(e: Error): void } | null = null;
let initPromise: Promise<void> | null = null;
let loginHint: string | undefined;
/** PRG-2: granular consent lets the user untick the app-folder box; sync is then off. */
let appDataGranted = false;

function onTokenResponse(response: google.accounts.oauth2.TokenResponse) {
  const p = pending;
  pending = null;
  if (!p) return;
  if (response.error) {
    p.reject(authError(response.error === "access_denied" ? "denied" : "unknown"));
    return;
  }
  // Granular consent: the user may untick Drive access on the consent screen.
  if (!google.accounts.oauth2.hasGrantedAllScopes(response, DRIVE_FILE_SCOPE)) {
    p.reject(authError("missing_scope"));
    return;
  }
  appDataGranted = google.accounts.oauth2.hasGrantedAllScopes(response, APPDATA_SCOPE);
  token = {
    accessToken: response.access_token,
    expiresAt: Date.now() + Number(response.expires_in) * 1000,
  };
  p.resolve(token.accessToken);
}

function onTokenError(error: google.accounts.oauth2.ClientConfigError) {
  const p = pending;
  pending = null;
  p?.reject(authError(error.type === "popup_failed_to_open" ? "popup_blocked" : error.type === "popup_closed" ? "popup_closed" : "unknown"));
}

/** Load GIS and create the token client. Call early (not in a click) so the popup can open synchronously later. */
export function initAuth(): Promise<void> {
  if (!isGoogleConfigured()) return Promise.reject(authError("not_configured"));
  initPromise ??= loadScript(GIS_SCRIPT_URL)
    .then(() => {
      client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPE_STRING,
        include_granted_scopes: false,
        callback: onTokenResponse,
        error_callback: onTokenError,
      });
    })
    .catch((err) => {
      initPromise = null;
      throw err;
    });
  return initPromise;
}

export function isAuthReady(): boolean {
  return client !== null;
}

export function hasValidToken(now = Date.now()): boolean {
  return token !== null && token.expiresAt - EXPIRY_SKEW_MS > now;
}

/**
 * Open the Google popup for a token. MUST be called synchronously from a user
 * gesture (click), or popup blockers stop it.
 */
export function requestToken(): Promise<string> {
  if (!isGoogleConfigured()) return Promise.reject(authError("not_configured"));
  if (!client) return Promise.reject(authError("not_ready"));
  return new Promise<string>((resolve, reject) => {
    pending?.reject(authError("popup_closed"));
    pending = { resolve, reject };
    // prompt "" = consent only if needed; an already-granted user sees the popup close by itself.
    client!.requestAccessToken({ prompt: "", login_hint: loginHint });
  });
}

/**
 * DRV-4: a valid token, refreshing it (popup that closes itself for a granted
 * user) when expired. Synchronous until the popup opens, so call from a click.
 */
export function ensureToken(): Promise<string> {
  if (hasValidToken() && token) return Promise.resolve(token.accessToken);
  return requestToken();
}

/** Forget the token after Drive answers 401, so the next action refreshes it. */
export function invalidateToken(): void {
  token = null;
}

export function setLoginHint(email: string | undefined): void {
  loginHint = email;
}

/** PRG-2: did the user allow PageTurn's hidden Drive app folder (progress sync)? */
export function canSync(): boolean {
  return appDataGranted;
}

export function currentToken(): string | null {
  return hasValidToken() && token ? token.accessToken : null;
}

/** DRV-1 sign out: revoke the grant and forget the token. */
export function signOutGoogle(): Promise<void> {
  const t = token?.accessToken;
  token = null;
  loginHint = undefined;
  appDataGranted = false;
  if (!t || typeof google === "undefined") return Promise.resolve();
  return new Promise((resolve) => google.accounts.oauth2.revoke(t, () => resolve()));
}

/** Test helper. */
export function _resetAuthForTests(): void {
  token = null;
  client = null;
  pending = null;
  initPromise = null;
  loginHint = undefined;
  appDataGranted = false;
}
