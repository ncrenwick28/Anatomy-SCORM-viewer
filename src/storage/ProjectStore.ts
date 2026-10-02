import type { Category, ExportConfig, ModelRecord, Project } from '../shared/types';
import { newId } from '../shared/ids';
import { DEFAULT_REGIONS, DEFAULT_SYSTEMS, defaultExportConfig } from '../shared/types';

/**
 * Persistent storage in the browser's IndexedDB.
 *
 *   meta    key → value        the Project (categories, export settings)
 *   models  id  → ModelRecord  metadata, annotations, saved views, asset references
 *   assets  id  → AssetRecord  the binary files: model files, thumbnails, logo (stored as Blobs)
 *
 * Everything lives in the origin's storage on this device. Clearing site data or switching browser
 * loses it, which is why project backup/restore exists (see backup.ts).
 */

export interface AssetRecord {
  id: string;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: string;
}

export const DB_NAME = 'anatomy-scorm-studio';
const DB_VERSION = 1;

export class StorageError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'StorageError';
  }
}

export function describeStorageError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'QuotaExceededError') return 'The browser has run out of storage space. Delete unused models or export a backup and free some space on this device.';
  if (name === 'InvalidStateError' || name === 'SecurityError') return 'The browser has blocked local storage (private browsing or restricted site data). Saving is unavailable in this mode.';
  if (name === 'VersionError') return 'This browser holds data from a newer version of the application. Update the application to open it.';
  return err instanceof Error ? err.message : 'An unknown storage error occurred.';
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

export function defaultProject(): Project {
  return {
    regions: DEFAULT_REGIONS.map((c) => ({ ...c })),
    systems: DEFAULT_SYSTEMS.map((c) => ({ ...c })),
    exportConfig: defaultExportConfig(),
  };
}

export class ProjectStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name = DB_NAME): Promise<ProjectStore> {
    if (typeof indexedDB === 'undefined') throw new StorageError('This browser does not provide IndexedDB, so work cannot be saved.');
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('models')) db.createObjectStore('models', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
    };
    try {
      const db = await wrap(req);
      return new ProjectStore(db);
    } catch (err) {
      throw new StorageError(describeStorageError(err), err);
    }
  }

  close(): void {
    this.db.close();
  }

  // ───────── project ─────────
  async getProject(): Promise<Project> {
    const tx = this.db.transaction('meta', 'readonly');
    const stored = (await wrap(tx.objectStore('meta').get('project'))) as Project | undefined;
    if (!stored) {
      const fresh = defaultProject();
      await this.putProject(fresh);
      return fresh;
    }
    const base = defaultProject();
    return {
      regions: Array.isArray(stored.regions) ? stored.regions : base.regions,
      systems: Array.isArray(stored.systems) ? stored.systems : base.systems,
      exportConfig: { ...base.exportConfig, ...stored.exportConfig, features: { ...base.exportConfig.features, ...stored.exportConfig?.features } },
    };
  }

  async putProject(project: Project): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(project, 'project');
    await done(tx);
  }

  // ───────── models ─────────
  async listModels(): Promise<ModelRecord[]> {
    const tx = this.db.transaction('models', 'readonly');
    const all = (await wrap(tx.objectStore('models').getAll())) as ModelRecord[];
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getModel(id: string): Promise<ModelRecord | undefined> {
    const tx = this.db.transaction('models', 'readonly');
    return (await wrap(tx.objectStore('models').get(id))) as ModelRecord | undefined;
  }

  async putModels(models: ModelRecord[]): Promise<void> {
    if (!models.length) return;
    const tx = this.db.transaction('models', 'readwrite');
    const store = tx.objectStore('models');
    for (const m of models) store.put(m);
    await done(tx);
  }

  /** Deletes a model and any asset that no remaining model (or the export logo) refers to. */
  async deleteModel(id: string): Promise<void> {
    const tx = this.db.transaction(['models', 'assets', 'meta'], 'readwrite');
    const models = tx.objectStore('models');
    const all = (await wrap(models.getAll())) as ModelRecord[];
    const target = all.find((m) => m.id === id);
    models.delete(id);
    if (target) {
      const project = (await wrap(tx.objectStore('meta').get('project'))) as Project | undefined;
      const keep = new Set<string>();
      for (const m of all) if (m.id !== id) for (const a of m.assets) keep.add(a.id), m.thumbnailAssetId && keep.add(m.thumbnailAssetId);
      if (project?.exportConfig.logoAssetId) keep.add(project.exportConfig.logoAssetId);
      const assets = tx.objectStore('assets');
      for (const a of target.assets) if (!keep.has(a.id)) assets.delete(a.id);
      if (target.thumbnailAssetId && !keep.has(target.thumbnailAssetId)) assets.delete(target.thumbnailAssetId);
    }
    await done(tx);
  }

  /**
   * Writes changed records only if nobody else has saved them since this tab last read them (optimistic
   * concurrency). All-or-nothing: on any conflict nothing is written. Each written record gets a new `rev`.
   */
  async commitChanges(changes: {
    models: { record: ModelRecord; baseRev: string | undefined }[];
    project?: { record: Project; baseRev: string | undefined };
  }): Promise<{ ok: true; revs: Record<string, string>; projectRev?: string } | { ok: false; conflicts: string[]; projectConflict: boolean }> {
    const tx = this.db.transaction(['models', 'meta'], 'readwrite');
    const models = tx.objectStore('models');
    const meta = tx.objectStore('meta');
    const conflicts: string[] = [];
    let projectConflict = false;
    const existing = await Promise.all(changes.models.map((c) => wrap(models.get(c.record.id)) as Promise<ModelRecord | undefined>));
    changes.models.forEach((c, i) => {
      const stored = existing[i];
      if ((stored?.rev ?? undefined) !== c.baseRev || (!stored && c.baseRev !== undefined)) conflicts.push(c.record.id);
    });
    if (changes.project) {
      const stored = (await wrap(meta.get('project'))) as Project | undefined;
      if ((stored?.rev ?? undefined) !== changes.project.baseRev) projectConflict = true;
    }
    if (conflicts.length || projectConflict) {
      tx.abort();
      await done(tx).catch(() => undefined);
      return { ok: false, conflicts, projectConflict };
    }
    const revs: Record<string, string> = {};
    for (const c of changes.models) {
      const rev = newId('rev');
      revs[c.record.id] = rev;
      models.put({ ...c.record, rev });
    }
    let projectRev: string | undefined;
    if (changes.project) {
      projectRev = newId('rev');
      meta.put({ ...changes.project.record, rev: projectRev }, 'project');
    }
    await done(tx);
    return { ok: true, revs, projectRev };
  }

  /** Current stored revisions (used to resolve a conflict by overwriting). */
  async getRevisions(ids: string[]): Promise<{ models: Record<string, string | undefined | null>; project: string | undefined }> {
    const tx = this.db.transaction(['models', 'meta'], 'readonly');
    const out: Record<string, string | undefined | null> = {};
    for (const id of ids) {
      const m = (await wrap(tx.objectStore('models').get(id))) as ModelRecord | undefined;
      out[id] = m ? m.rev : null; // null = no longer exists
    }
    const p = (await wrap(tx.objectStore('meta').get('project'))) as Project | undefined;
    return { models: out, project: p?.rev };
  }

  // ───────── assets ─────────
  async putAsset(rec: AssetRecord): Promise<void> {
    const tx = this.db.transaction('assets', 'readwrite');
    tx.objectStore('assets').put(rec);
    await done(tx);
  }

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    const tx = this.db.transaction('assets', 'readonly');
    return (await wrap(tx.objectStore('assets').get(id))) as AssetRecord | undefined;
  }

  async deleteAssets(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const tx = this.db.transaction('assets', 'readwrite');
    for (const id of ids) tx.objectStore('assets').delete(id);
    await done(tx);
  }

  /**
   * Removes assets that no model, thumbnail or logo refers to — leftovers from an import interrupted by a
   * reload or crash. Only assets older than `graceMs` are touched so another tab's in-progress import is safe.
   */
  async sweepOrphanAssets(graceMs = 10 * 60 * 1000): Promise<number> {
    const tx = this.db.transaction(['models', 'assets', 'meta'], 'readwrite');
    const models = (await wrap(tx.objectStore('models').getAll())) as ModelRecord[];
    const project = (await wrap(tx.objectStore('meta').get('project'))) as Project | undefined;
    const keep = new Set<string>();
    for (const m of models) {
      m.assets.forEach((a) => keep.add(a.id));
      if (m.thumbnailAssetId) keep.add(m.thumbnailAssetId);
    }
    if (project?.exportConfig.logoAssetId) keep.add(project.exportConfig.logoAssetId);
    const cutoff = Date.now() - graceMs;
    let removed = 0;
    const store = tx.objectStore('assets');
    const all = (await wrap(store.getAll())) as AssetRecord[];
    for (const a of all) {
      if (!keep.has(a.id) && Date.parse(a.createdAt) < cutoff) {
        store.delete(a.id);
        removed++;
      }
    }
    await done(tx);
    return removed;
  }

  async listAssetIds(): Promise<string[]> {
    const tx = this.db.transaction('assets', 'readonly');
    return (await wrap(tx.objectStore('assets').getAllKeys())) as string[];
  }

  // ───────── bulk ─────────
  /** Atomically replaces everything. Used by "restore (replace)"; on failure nothing changes. */
  async replaceAll(project: Project, models: ModelRecord[], assets: AssetRecord[]): Promise<void> {
    const tx = this.db.transaction(['meta', 'models', 'assets'], 'readwrite');
    tx.objectStore('models').clear();
    tx.objectStore('assets').clear();
    tx.objectStore('meta').put(project, 'project');
    for (const m of models) tx.objectStore('models').put(m);
    for (const a of assets) tx.objectStore('assets').put(a);
    await done(tx);
  }

  async addAll(models: ModelRecord[], assets: AssetRecord[], project: Project): Promise<void> {
    const tx = this.db.transaction(['meta', 'models', 'assets'], 'readwrite');
    tx.objectStore('meta').put(project, 'project');
    for (const m of models) tx.objectStore('models').put(m);
    for (const a of assets) tx.objectStore('assets').put(a);
    await done(tx);
  }

  async estimate(): Promise<{ usage: number; quota: number } | null> {
    try {
      const e = await navigator.storage?.estimate?.();
      return e && typeof e.quota === 'number' ? { usage: e.usage ?? 0, quota: e.quota } : null;
    } catch {
      return null;
    }
  }

  async requestPersistence(): Promise<boolean> {
    try {
      return (await navigator.storage?.persist?.()) ?? false;
    } catch {
      return false;
    }
  }
}

export function categoryName(list: Category[], id: string): string {
  return list.find((c) => c.id === id)?.name ?? id;
}

export type { ExportConfig };
