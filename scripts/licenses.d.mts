import type { Plugin } from "vite";
export const LICENSES_FILE: string;
export const EXTRA_PACKAGES: string[];
/** Rollup module id → npm package name, or null for the app's own code. */
export function packageNameFromId(id: string): string | null;
/** The full notices text for these packages. Throws if one has no LICENSE file. */
export function buildLicensesText(names: string[], options?: { from?: string; assetsDir?: string }): string;
/** Vite plugin: emits dist/third-party-licenses.txt in production builds. */
export function thirdPartyLicenses(): Plugin;
