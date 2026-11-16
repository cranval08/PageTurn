/**
 * Memory NFR: an LRU of rendered pages. At most `capacity` entries are kept;
 * adding beyond that evicts the least recently used one and calls `onEvict`
 * so its canvas can be released.
 */
export class PageCache<K, V> {
  private readonly entries = new Map<K, V>();
  readonly capacity: number;
  private readonly onEvict: (key: K, value: V) => void;

  constructor(capacity: number, onEvict: (key: K, value: V) => void) {
    if (capacity < 1) throw new Error("capacity must be at least 1");
    this.capacity = capacity;
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Read and mark as most recently used. */
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  /** Read without changing recency. */
  peek(key: K): V | undefined {
    return this.entries.get(key);
  }

  set(key: K, value: V): void {
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.entries.delete(key);
      if (previous !== value) this.onEvict(key, previous);
    }
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const [oldestKey, oldest] = this.entries.entries().next().value as [K, V];
      this.entries.delete(oldestKey);
      this.onEvict(oldestKey, oldest);
    }
  }

  delete(key: K): void {
    const value = this.entries.get(key);
    if (value === undefined) return;
    this.entries.delete(key);
    this.onEvict(key, value);
  }

  clear(): void {
    for (const [k, v] of this.entries) this.onEvict(k, v);
    this.entries.clear();
  }

  keys(): K[] {
    return [...this.entries.keys()];
  }
}
