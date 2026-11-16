import Dexie, { type EntityTable } from "dexie";
import type { LayoutMode } from "../layout";

/** PRD data model. Ids: Drive fileId, or "local:" + SHA-256 of the file. */
export interface Book {
  id: string;
  source: "drive" | "local";
  title: string;
  pageCount: number;
  sizeBytes: number;
  driveModifiedTime?: string;
  /** Page 1 thumbnail, ~300 px wide (JPEG data URL). */
  coverDataUrl: string;
  addedAt: number;
  lastOpenedAt: number;
}

/** PDF bytes live in their own table so the library list loads fast. */
export interface FileBlob {
  bookId: string;
  data: Blob;
}

export interface Progress {
  bookId: string;
  /** 1-based; the left page of a spread. */
  page: number;
  updatedAt: number;
  bookmarks: number[];
}

export interface Settings {
  layout: LayoutMode;
  theme: "light" | "sepia" | "dark";
  animation: "curl" | "slide" | "none";
  sound: boolean;
}

/** Small key/value table (settings). */
export interface KeyValue {
  key: string;
  value: string;
}

export class PageTurnDB extends Dexie {
  books!: EntityTable<Book, "id">;
  files!: EntityTable<FileBlob, "bookId">;
  progress!: EntityTable<Progress, "bookId">;
  kv!: EntityTable<KeyValue, "key">;

  constructor(name = "pageturn") {
    super(name);
    this.version(1).stores({
      books: "id, lastOpenedAt, addedAt, title",
      files: "bookId",
      progress: "bookId",
      kv: "key",
    });
  }
}

export const db = new PageTurnDB();
