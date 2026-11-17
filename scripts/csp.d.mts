import type { Plugin } from "vite";
export const CSP_DIRECTIVES: Record<string, string[]>;
export function contentSecurityPolicy(directives?: Record<string, string[]>): string;
/** Vite plugin: adds the CSP <meta> to index.html in production builds. */
export function cspMeta(): Plugin;
