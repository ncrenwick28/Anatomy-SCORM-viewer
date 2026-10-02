import { newId } from '../shared/ids';
import { backupSchema, formatZodError, type BackupManifest } from '../shared/schema';
import { LIMITS, SCHEMA_VERSION, type ModelRecord, type Project } from '../shared/types';
import { buildZip, isSafeArchivePath, readZip, type ZipEntry, ZipLimitError } from '../shared/zip';
import type { AssetRecord, ProjectStore } from './ProjectStore';

/**
 * Project backup and restore.
 *
 * A backup is a ZIP with `project.json` (validated metadata, annotations, views, categories and
 * export settings) and `assets/<id>/<file>` for every model file, thumbnail and logo. It is the
 * supported way to move work between browsers/computers and to recover from cleared site data.
 */

export class BackupError extends Error {}

export interface BackupResult {
  blob: Blob;
  filename: string;
  modelCount: number;
  assetCount: number;
  bytes: number;
}

export async function createBackup(store: ProjectStore, onProgress?: (done: number, total: number) => void): Promise<BackupResult> {
  const project = await store.getProject();
  const models = await store.listModels();
  const ids = new Set<string>();
  for (const m of models) {
    for (const a of m.assets) ids.add(a.id);
    if (m.thumbnailAssetId) ids.add(m.thumbnailAssetId);
  }
  if (project.exportConfig.logoAssetId) ids.add(project.exportConfig.logoAssetId);
  const records: AssetRecord[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const rec = await store.getAsset(id);
    if (rec) records.push(rec);
    else missing.push(id);
  }
  // A thumbnail can be regenerated, but a missing model file means the backup would be incomplete.
  const missingModelFiles = models.filter((m) => m.assets.some((a) => missing.includes(a.id)));
  if (missingModelFiles.length) {
    throw new BackupError(`Cannot create a complete backup: stored files are missing for ${missingModelFiles.map((m) => `"${m.title}"`).join(', ')}.`);
  }
  const manifest: BackupManifest = {
    app: 'anatomy-scorm-studio',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    regions: project.regions,
    systems: project.systems,
    exportConfig: {
      ...project.exportConfig,
      logoAssetId: project.exportConfig.logoAssetId && !missing.includes(project.exportConfig.logoAssetId) ? project.exportConfig.logoAssetId : null,
    },
    models: models.map((m) => ({ ...m, thumbnailAssetId: m.thumbnailAssetId && !missing.includes(m.thumbnailAssetId) ? m.thumbnailAssetId : null })),
    assets: records.map((r) => ({ id: r.id, path: `assets/${r.id}/${r.name}`, size: r.size, mime: r.mime, name: r.name })),
  };
  const entries: ZipEntry[] = [{ path: 'project.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)), compress: true }];
  for (const r of records) entries.push({ path: `assets/${r.id}/${r.name}`, data: r.blob, compress: false });
  const blob = await buildZip(entries, (d, t) => onProgress?.(d, t));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return { blob, filename: `anatomy-project-backup-${stamp}.zip`, modelCount: models.length, assetCount: records.length, bytes: blob.size };
}

export interface ParsedBackup {
  manifest: BackupManifest;
  files: Map<string, Uint8Array>;
  warnings: string[];
  totalBytes: number;
}

export async function parseBackup(file: Blob): Promise<ParsedBackup> {
  if (file.size > LIMITS.maxBackupBytes) throw new BackupError('This file is larger than the maximum backup size this application will open.');
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!(head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05))) {
    throw new BackupError('This file is not a valid ZIP archive. Choose a backup created with “Download project backup”.');
  }
  let files: Map<string, Uint8Array>;
  try {
    files = await readZip(file, { maxTotalBytes: LIMITS.maxBackupBytes, maxEntries: 25000 });
  } catch (err) {
    if (err instanceof ZipLimitError) throw new BackupError(err.message);
    throw new BackupError('This file is not a valid ZIP archive, or it is damaged.');
  }
  const raw = files.get('project.json');
  if (!raw) throw new BackupError('This ZIP is not a project backup: project.json is missing.');
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new BackupError('project.json in this backup is not valid JSON.');
  }
  const probe = (json as { app?: unknown; schemaVersion?: unknown }) ?? {};
  if (probe.app !== 'anatomy-scorm-studio') throw new BackupError('This ZIP was not created by this application.');
  if (typeof probe.schemaVersion === 'number' && probe.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(`This backup was made by a newer version (schema ${probe.schemaVersion}). Update the application to restore it.`);
  }
  const result = backupSchema.safeParse(json);
  if (!result.success) throw new BackupError(`The backup contents are invalid: ${formatZodError(result.error)}`);
  const manifest = result.data;
  const warnings: string[] = [];
  const byId = new Map(manifest.assets.map((a) => [a.id, a]));
  let total = 0;
  for (const a of manifest.assets) {
    if (!isSafeArchivePath(a.path)) throw new BackupError(`The backup contains an unsafe file path: ${a.path}`);
    const data = files.get(a.path);
    if (!data) throw new BackupError(`The backup is incomplete: "${a.path}" is missing from the archive.`);
    if (data.length !== a.size) throw new BackupError(`"${a.path}" is damaged (expected ${a.size} bytes, found ${data.length}).`);
    total += data.length;
  }
  const modelIds = new Set<string>();
  for (const m of manifest.models) {
    if (modelIds.has(m.id)) throw new BackupError(`The backup lists model "${m.title}" more than once.`);
    modelIds.add(m.id);
    for (const ref of m.assets) {
      const a = byId.get(ref.id);
      if (!a) throw new BackupError(`Model "${m.title}" refers to a file that is not in the backup (${ref.name}).`);
      if (a.size !== ref.size) throw new BackupError(`Model "${m.title}": file "${ref.name}" does not match its recorded size.`);
    }
    if (!m.assets.some((a) => a.name === m.entryName)) throw new BackupError(`Model "${m.title}": entry file "${m.entryName}" is not among its files.`);
    if (m.thumbnailAssetId && !byId.has(m.thumbnailAssetId)) {
      warnings.push(`The thumbnail for "${m.title}" is missing and will be regenerated.`);
      m.thumbnailAssetId = null;
    }
  }
  if (manifest.exportConfig.logoAssetId && !byId.has(manifest.exportConfig.logoAssetId)) {
    warnings.push('The package logo is missing from the backup.');
    manifest.exportConfig.logoAssetId = null;
  }
  manifest.exportConfig.selectedModelIds = manifest.exportConfig.selectedModelIds.filter((id) => modelIds.has(id));
  return { manifest, files, warnings, totalBytes: total };
}

function toAssetRecord(a: BackupManifest['assets'][number], bytes: Uint8Array, id = a.id): AssetRecord {
  return { id, name: a.name, mime: a.mime, size: bytes.length, blob: new Blob([bytes as BlobPart], { type: a.mime }), createdAt: new Date().toISOString() };
}

export async function restoreBackup(store: ProjectStore, parsed: ParsedBackup, mode: 'replace' | 'merge'): Promise<{ models: number }> {
  const { manifest, files } = parsed;
  const assetMeta = new Map(manifest.assets.map((a) => [a.id, a]));
  if (mode === 'replace') {
    const project: Project = { regions: manifest.regions, systems: manifest.systems, exportConfig: manifest.exportConfig };
    const assets = manifest.assets.map((a) => toAssetRecord(a, files.get(a.path)!));
    await store.replaceAll(project, manifest.models as ModelRecord[], assets);
    return { models: manifest.models.length };
  }
  // Merge: always mint fresh ids so restoring the same backup twice never overwrites or collides.
  const current = await store.getProject();
  const assetIdMap = new Map<string, string>();
  const assets: AssetRecord[] = [];
  const mapAsset = (id: string): string => {
    let nid = assetIdMap.get(id);
    if (!nid) {
      nid = newId('asset');
      assetIdMap.set(id, nid);
      const a = assetMeta.get(id)!;
      assets.push(toAssetRecord(a, files.get(a.path)!, nid));
    }
    return nid;
  };
  const now = new Date().toISOString();
  const models: ModelRecord[] = manifest.models.map((m) => ({
    ...(m as ModelRecord),
    id: newId('model'),
    assets: m.assets.map((a) => ({ ...a, id: mapAsset(a.id) })),
    thumbnailAssetId: m.thumbnailAssetId ? mapAsset(m.thumbnailAssetId) : null,
    createdAt: now,
    updatedAt: now,
  }));
  const mergeCats = (a: { id: string; name: string }[], b: { id: string; name: string }[]) => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))];
  const project: Project = {
    regions: mergeCats(current.regions, manifest.regions),
    systems: mergeCats(current.systems, manifest.systems),
    exportConfig: current.exportConfig,
  };
  await store.addAll(models, assets, project);
  return { models: models.length };
}
