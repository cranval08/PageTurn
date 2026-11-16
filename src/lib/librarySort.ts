import type { Book } from "./db/schema";

export type LibrarySort = "recent" | "title" | "added";

export const SORT_LABELS: Record<LibrarySort, string> = {
  recent: "Last opened",
  title: "Title",
  added: "Date added",
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Lower-case, accent-free form for matching ("Évolution" matches "evol"). */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** LIB-2: filter by title (every word must match) and sort. Never mutates `books`. */
export function sortAndFilter(books: readonly Book[], sort: LibrarySort, query: string): Book[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const matched = words.length ? books.filter((b) => words.every((w) => normalize(b.title).includes(w))) : [...books];
  switch (sort) {
    case "title":
      return matched.sort((a, b) => collator.compare(a.title, b.title));
    case "added":
      return matched.sort((a, b) => b.addedAt - a.addedAt);
    default:
      return matched.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }
}

const SORT_KEY = "pageturn.librarySort";

/** The chosen sort is a per-device convenience, kept in localStorage (wrapped: storage may be blocked). */
export function loadSort(): LibrarySort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === "title" || v === "added" || v === "recent" ? v : "recent";
  } catch {
    return "recent";
  }
}

export function saveSort(sort: LibrarySort): void {
  try {
    localStorage.setItem(SORT_KEY, sort);
  } catch {
    /* private mode / blocked storage: just don't remember */
  }
}
