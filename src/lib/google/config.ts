/** Values from .env.local (never committed). */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_API_KEY: string = import.meta.env.VITE_GOOGLE_API_KEY ?? "";
export const GOOGLE_APP_ID: string = import.meta.env.VITE_GOOGLE_APP_ID ?? "";

export const isGoogleConfigured = (): boolean => Boolean(GOOGLE_CLIENT_ID && GOOGLE_API_KEY && GOOGLE_APP_ID);

/**
 * The ONLY OAuth scopes PageTurn requests (PRD "Google setup and OAuth scopes").
 * drive.file: files the user picks in the Picker. drive.appdata: PageTurn's own
 * hidden app folder (PRG-2 progress sync). openid/email/profile: name and avatar.
 * Never add full `drive`.
 */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

export const SCOPES = [
  DRIVE_FILE_SCOPE,
  APPDATA_SCOPE,
  "openid",
  "email",
  "profile",
] as const;

export const SCOPE_STRING = SCOPES.join(" ");

export const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
export const GAPI_SCRIPT_URL = "https://apis.google.com/js/api.js";
export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
export const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
