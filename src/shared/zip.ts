import { Zip, ZipDeflate, ZipPassThrough, Unzip, UnzipInflate } from 'fflate';

/**
 * ZIP reading and writing for browsers and Node, built on fflate's streaming API so large assets are
 * never compressed or decompressed in one synchronous call.
 */

export interface ZipEntry {
  /** Forward-slash relative path, e.g. "models/heart/heart.glb". */
  path: string;
  data: Uint8Array | Blob | (() => Promise<Uint8Array | Blob>);
  /** Text-like data is deflated; already-compressed binaries are stored. */
  compress?: boolean;
}

const MAX_CHUNK = 4 * 1024 * 1024;

async function toBytes(d: Uint8Array | Blob): Promise<Uint8Array> {
  return d instanceof Uint8Array ? d : new Uint8Array(await d.arrayBuffer());
}

export function isCompressible(path: string): boolean {
  return /\.(json|js|css|html|xml|gltf|svg|txt|md)$/i.test(path);
}

export async function buildZip(
  entries: ZipEntry[],
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  let finished: () => void = () => {};
  const finishedP = new Promise<void>((r) => (finished = r));
  const zip = new Zip((err, chunk, final) => {
    if (err) failure = err;
    else chunks.push(chunk);
    if (final || err) finished();
  });
  let n = 0;
  for (const e of entries) {
    const bytes = await toBytes(typeof e.data === 'function' ? await e.data() : e.data);
    const file = (e.compress ?? isCompressible(e.path)) ? new ZipDeflate(e.path, { level: 6 }) : new ZipPassThrough(e.path);
    // A fixed timestamp keeps archives reproducible.
    (file as { mtime?: number }).mtime = Date.UTC(2026, 0, 1);
    zip.add(file);
    for (let i = 0; i < bytes.length; i += MAX_CHUNK) file.push(bytes.subarray(i, Math.min(bytes.length, i + MAX_CHUNK)), i + MAX_CHUNK >= bytes.length);
    if (!bytes.length) file.push(new Uint8Array(0), true);
    onProgress?.(++n, entries.length, e.path);
    // Yield so progress UIs can repaint between large files.
    await new Promise((r) => setTimeout(r, 0));
  }
  zip.end();
  await finishedP;
  if (failure) throw failure;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

export class ZipLimitError extends Error {}

export interface ReadZipOptions {
  /** Maximum total decompressed bytes accepted (zip-bomb protection). */
  maxTotalBytes: number;
  maxEntries: number;
}

/** Reads every file of a zip into memory with strict limits. Directory entries are skipped. */
export async function readZip(blob: Blob, opts: ReadZipOptions): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  let total = 0;
  let entries = 0;
  let failure: Error | null = null;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (failure || file.name.endsWith('/')) return;
    if (++entries > opts.maxEntries) {
      failure = new ZipLimitError(`The archive contains more than ${opts.maxEntries} files.`);
      return;
    }
    const parts: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) {
        failure = err;
        return;
      }
      total += chunk.length;
      if (total > opts.maxTotalBytes) {
        failure = new ZipLimitError('The archive expands to more data than is allowed. It may be damaged or malicious.');
        file.terminate();
        return;
      }
      parts.push(chunk);
      if (final) {
        const merged = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
        let o = 0;
        for (const p of parts) {
          merged.set(p, o);
          o += p.length;
        }
        out.set(file.name, merged);
      }
    };
    try {
      file.start();
    } catch (e) {
      failure = e as Error;
    }
  };
  const SLICE = 4 * 1024 * 1024;
  for (let i = 0; i < blob.size && !failure; i += SLICE) {
    const buf = new Uint8Array(await blob.slice(i, Math.min(blob.size, i + SLICE)).arrayBuffer());
    unzip.push(buf, i + SLICE >= blob.size);
  }
  if (failure) throw failure;
  return out;
}

export function isSafeArchivePath(path: string): boolean {
  return !!path && !path.startsWith('/') && !/(^|\/)\.\.(\/|$)/.test(path) && !path.includes('\\') && !/^[a-z]:/i.test(path);
}
