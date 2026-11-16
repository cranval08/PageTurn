import type { StateStorage } from "zustand/middleware";
import { db } from "./schema";

/** Zustand persist storage backed by the IndexedDB key/value table. */
export const idbStateStorage: StateStorage = {
  async getItem(name) {
    return (await db.kv.get(name))?.value ?? null;
  },
  async setItem(name, value) {
    await db.kv.put({ key: name, value });
  },
  async removeItem(name) {
    await db.kv.delete(name);
  },
};
