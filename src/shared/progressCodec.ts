import { LMS_SUSPEND_DATA_LIMIT } from './types';
import type { Progress } from './completion';

/**
 * Compact progress encoding for cmi.suspend_data.
 *
 * SCORM 1.2 allows only 4096 characters in suspend_data, so progress is stored as bitmasks over the
 * package's model order and each model's annotation order rather than as lists of ids:
 *
 *   "a1|<hash>|<last>|<openedHex>|<idx>:<hex>,<idx>:<hex>"
 *
 * `hash` identifies the package contents. If a re-uploaded package has different content the stored
 * bit positions may no longer match, so annotation progress is discarded (completion status already
 * recorded by the LMS is unaffected).
 */

export interface CodecModel {
  id: string;
  annotationIds: string[];
}

function bitsToHex(bits: boolean[]): string {
  let out = '';
  for (let i = 0; i < bits.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) if (bits[i + j]) n |= 1 << j;
    out += n.toString(16);
  }
  return out.replace(/0+$/, '');
}

function hexToBits(hex: string, length: number): boolean[] {
  const bits = new Array<boolean>(length).fill(false);
  for (let i = 0; i < hex.length; i++) {
    const n = parseInt(hex[i], 16);
    if (Number.isNaN(n)) continue;
    for (let j = 0; j < 4; j++) {
      const idx = i * 4 + j;
      if (idx < length && n & (1 << j)) bits[idx] = true;
    }
  }
  return bits;
}

export function encodeProgress(hash: string, models: CodecModel[], p: Progress): string {
  const opened = new Set(p.opened);
  const lastIdx = p.lastModelId ? models.findIndex((m) => m.id === p.lastModelId) : -1;
  const openedHex = bitsToHex(models.map((m) => opened.has(m.id)));
  const annParts: string[] = [];
  models.forEach((m, idx) => {
    const viewed = new Set(p.viewed[m.id] ?? []);
    if (!viewed.size) return;
    const hex = bitsToHex(m.annotationIds.map((a) => viewed.has(a)));
    if (hex) annParts.push(`${idx.toString(36)}:${hex}`);
  });
  const base = `a1|${hash}|${lastIdx < 0 ? '' : lastIdx.toString(36)}|${openedHex}|`;
  let data = base + annParts.join(',');
  // Degrade gracefully rather than exceed the SCORM 1.2 limit: drop annotation detail first.
  if (data.length > LMS_SUSPEND_DATA_LIMIT) data = base;
  return data;
}

export interface DecodeResult {
  progress: Progress;
  /** False when the stored hash differs from the current package, so annotation progress was dropped. */
  contentMatched: boolean;
}

export function decodeProgress(raw: string, hash: string, models: CodecModel[]): DecodeResult | null {
  if (!raw || !raw.startsWith('a1|')) return null;
  const parts = raw.split('|');
  if (parts.length < 5) return null;
  const [, storedHash, last, openedHex, annRaw] = parts;
  const contentMatched = storedHash === hash;
  const progress: Progress = { opened: [], viewed: {}, lastModelId: null };
  if (!contentMatched) return { progress, contentMatched };
  const openedBits = hexToBits(openedHex, models.length);
  models.forEach((m, i) => {
    if (openedBits[i]) progress.opened.push(m.id);
  });
  const lastIdx = last ? parseInt(last, 36) : -1;
  if (lastIdx >= 0 && lastIdx < models.length) progress.lastModelId = models[lastIdx].id;
  for (const seg of (annRaw ?? '').split(',')) {
    if (!seg) continue;
    const [idxRaw, hex] = seg.split(':');
    const idx = parseInt(idxRaw, 36);
    const m = models[idx];
    if (!m || !hex) continue;
    const bits = hexToBits(hex, m.annotationIds.length);
    const ids = m.annotationIds.filter((_, i) => bits[i]);
    if (ids.length) progress.viewed[m.id] = ids;
  }
  return { progress, contentMatched };
}
