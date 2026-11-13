import { getStore } from "@netlify/blobs";

export interface KV {
  getText(k: string): Promise<string | null>;
  setText(k: string, v: string): Promise<void>;
  /** The value plus a tag that changes on every write, for `setTextIfMatch`. */
  getTextTagged(k: string): Promise<{ value: string; etag: string } | null>;
  /** Writes only if the value still has `etag`. Resolves false, writing nothing, if it was changed or deleted since. */
  setTextIfMatch(k: string, v: string, etag: string): Promise<boolean>;
  getBytes(k: string): Promise<ArrayBuffer | null>;
  setBytes(k: string, v: ArrayBuffer): Promise<void>;
  delete(k: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export function memoryKV(): KV {
  const m = new Map<string, string | ArrayBuffer>();
  const etags = new Map<string, string>();
  let writes = 0;
  const put = (k: string, v: string | ArrayBuffer) => {
    m.set(k, v);
    etags.set(k, `"${++writes}"`);
  };
  return {
    async getText(k) {
      const v = m.get(k);
      return typeof v === "string" ? v : null;
    },
    async setText(k, v) {
      put(k, v);
    },
    async getTextTagged(k) {
      const v = m.get(k);
      return typeof v === "string" ? { value: v, etag: etags.get(k)! } : null;
    },
    async setTextIfMatch(k, v, etag) {
      if (!m.has(k) || etags.get(k) !== etag) return false;
      put(k, v);
      return true;
    },
    async getBytes(k) {
      const v = m.get(k);
      return v instanceof ArrayBuffer ? v.slice(0) : null;
    },
    async setBytes(k, v) {
      put(k, v.slice(0));
    },
    async delete(k) {
      m.delete(k);
      etags.delete(k);
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
    async getTextTagged(k) {
      const r = await store.getWithMetadata(k, { type: "text" });
      if (!r) return null;
      // Without an etag the conditional write below can't be made safe, so fail loudly instead.
      if (!r.etag) throw new Error(`blob store returned no etag for ${k}`);
      return { value: r.data, etag: r.etag };
    },
    async setTextIfMatch(k, v, etag) {
      // Atomic on the Blobs side: the write lands only if nobody wrote the key since it was read.
      return (await store.set(k, v, { onlyIfMatch: etag })).modified;
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
