// Phase 1 only: books opened during this session, held in memory.
// Phase 2 replaces this with the Dexie (IndexedDB) store.
export interface OpenBook {
  id: string;
  title: string;
  data: Blob;
}

const books = new Map<string, OpenBook>();

export function putSessionBook(book: OpenBook): void {
  books.set(book.id, book);
}

export function getSessionBook(id: string): OpenBook | undefined {
  return books.get(id);
}
