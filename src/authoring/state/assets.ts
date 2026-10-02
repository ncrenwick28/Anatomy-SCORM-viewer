import { getDb } from './db';
import type { ModelRecord } from '../../shared/types';
import type { ModelSource } from '../../viewer/types';

const urlCache = new Map<string, Promise<string | null>>();

/** A blob: URL for a stored asset (cached for the session; used for thumbnails and logos). */
export function assetUrl(id: string | null | undefined): Promise<string | null> {
  if (!id) return Promise.resolve(null);
  let p = urlCache.get(id);
  if (!p) {
    p = getDb()
      .then((db) => db.getAsset(id))
      .then((rec) => (rec ? URL.createObjectURL(rec.blob) : null))
      .catch(() => null);
    urlCache.set(id, p);
  }
  return p;
}

export function forgetAssetUrl(id: string): void {
  const p = urlCache.get(id);
  urlCache.delete(id);
  p?.then((u) => u && URL.revokeObjectURL(u));
}

/** Blob URLs for all files of a model. Call dispose() when the viewer is done with them. */
export async function openModelSource(model: Pick<ModelRecord, 'assets' | 'entryName' | 'format'>): Promise<{ source: ModelSource; dispose: () => void }> {
  const db = await getDb();
  const urls: Record<string, string> = {};
  const made: string[] = [];
  try {
    for (const ref of model.assets) {
      const rec = await db.getAsset(ref.id);
      if (!rec) throw new Error(`The stored file "${ref.name}" is missing. Re-import the model or restore a backup.`);
      const u = URL.createObjectURL(rec.blob);
      made.push(u);
      urls[ref.name] = u;
    }
  } catch (e) {
    made.forEach((u) => URL.revokeObjectURL(u));
    throw e;
  }
  return { source: { entryName: model.entryName, format: model.format, urls }, dispose: () => made.forEach((u) => URL.revokeObjectURL(u)) };
}
