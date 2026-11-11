import { getStore } from "@netlify/blobs";

export interface KV {
  getText(k: string): Promise<string | null>;
  setText(k: string, v: string): Promise<void>;
  getBytes(k: string): Promise<ArrayBuffer | null>;
  setBytes(k: string, v: ArrayBuffer): Promise<void>;
  delete(k: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export function memoryKV(): KV {
  const m = new Map<string, string | ArrayBuffer>();
  return {
    async getText(k) {
      const v = m.get(k);
      return typeof v === "string" ? v : null;
    },
    async setText(k, v) {
      m.set(k, v);
    },
    async getBytes(k) {
      const v = m.get(k);
      return v instanceof ArrayBuffer ? v.slice(0) : null;
    },
    async setBytes(k, v) {
      m.set(k, v.slice(0));
    },
    async delete(k) {
      m.delete(k);
    },
    async list(prefix) {
      return [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

export function blobsKV(): KV {
  // Strong consistency: a write must be visible to the very next read (transpose, setlist edits, uploads).
  const store = getStore({ name: "band", consistency: "strong" });
  return {
    async getText(k) {
      return (await store.get(k, { type: "text" })) ?? null;
    },
    async setText(k, v) {
      await store.set(k, v);
    },
    async getBytes(k) {
      return (await store.get(k, { type: "arrayBuffer" })) ?? null;
    },
    async setBytes(k, v) {
      await store.set(k, v);
    },
    async delete(k) {
      await store.delete(k);
    },
    async list(prefix) {
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key);
    },
  };
}
