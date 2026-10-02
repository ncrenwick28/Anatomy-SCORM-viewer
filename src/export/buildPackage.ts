import { readableTextOn } from '../shared/color';
import { CONTENT_GLOBAL, type PackageContent, type PackageModel } from '../shared/content';
import { shortHash, slugify } from '../shared/ids';
import { APP_NAME, APP_VERSION } from '../shared/version';
import { buildZip, type ZipEntry } from '../shared/zip';
import type { Category, ExportConfig, ModelRecord } from '../shared/types';
import { generateLaunchPage } from './launchPage';
import { generateManifest12 } from './manifest';

export interface PlayerAssets {
  js: Uint8Array;
  css: Uint8Array;
  /** Draco decoder files, included only when a selected model needs them. */
  draco?: { name: string; data: Uint8Array }[];
}

export interface AssetData {
  name: string;
  blob: Blob | Uint8Array;
  mime: string;
}

export interface BuildInput {
  config: ExportConfig;
  regions: Category[];
  systems: Category[];
  /** Selected models, in display order. */
  models: ModelRecord[];
  readAsset: (id: string) => Promise<AssetData | undefined>;
  player: PlayerAssets;
  now?: Date;
}

export interface BuiltPackage {
  blob: Blob;
  content: PackageContent;
  manifestXml: string;
  files: { path: string; size: number }[];
  bytes: number;
}

export class PackageBuildError extends Error {}

export function needsDraco(models: ModelRecord[]): boolean {
  return models.some((m) => m.stats.extensionsUsed.includes('KHR_draco_mesh_compression'));
}

const sizeOf = (d: Blob | Uint8Array) => (d instanceof Uint8Array ? d.length : d.size);

function extFor(name: string, mime: string): string {
  const e = name.split('.').pop()?.toLowerCase();
  if (e && /^[a-z0-9]{2,5}$/.test(e)) return e;
  return mime === 'image/png' ? 'png' : mime === 'image/svg+xml' ? 'svg' : mime === 'image/webp' ? 'webp' : 'jpg';
}

/**
 * Builds the SCORM 1.2 package. Only the selected models and the files they need are included, all
 * paths are relative, and nothing is fetched from any remote host.
 */
export async function buildScormPackage(input: BuildInput, onProgress?: (done: number, total: number, label: string) => void): Promise<BuiltPackage> {
  const { config, models } = input;
  if (!models.length) throw new PackageBuildError('Select at least one model to export.');
  const builtAt = (input.now ?? new Date()).toISOString();
  const entries: ZipEntry[] = [];
  const listed: { path: string; size: number }[] = [];
  const addEntry = (path: string, data: Uint8Array | Blob, compress?: boolean) => {
    entries.push({ path, data, compress });
    listed.push({ path, size: sizeOf(data) });
  };

  const usedDirs = new Set<string>();
  const packageModels: PackageModel[] = [];
  for (const m of models) {
    let dir = `${slugify(m.title, 'model')}-${shortHash(m.id).slice(0, 5)}`;
    while (usedDirs.has(dir)) dir += 'x';
    usedDirs.add(dir);
    const files: Record<string, string> = {};
    for (const ref of m.assets) {
      const asset = await input.readAsset(ref.id);
      if (!asset) throw new PackageBuildError(`A stored file for "${m.title}" is missing (${ref.name}). Re-import the model or restore a backup.`);
      if (sizeOf(asset.blob) !== ref.size) throw new PackageBuildError(`The stored file "${ref.name}" for "${m.title}" does not match its recorded size and may be corrupted.`);
      const path = `models/${dir}/${ref.name}`;
      files[ref.name] = path;
      addEntry(path, asset.blob, /\.(gltf)$/i.test(ref.name));
    }
    if (!m.thumbnailAssetId) throw new PackageBuildError(`"${m.title}" has no thumbnail. Generate thumbnails before exporting.`);
    const thumb = await input.readAsset(m.thumbnailAssetId);
    if (!thumb) throw new PackageBuildError(`The thumbnail for "${m.title}" is missing from storage.`);
    const thumbPath = `thumbs/${dir}.${extFor(thumb.name, thumb.mime)}`;
    addEntry(thumbPath, thumb.blob, false);
    packageModels.push({
      id: m.id,
      title: m.title,
      description: m.description,
      credit: m.credit,
      isDemo: m.isDemo,
      regionIds: m.regionIds,
      systemIds: m.systemIds,
      thumbnail: thumbPath,
      entry: files[m.entryName],
      format: m.format,
      files,
      view: m.view,
      annotations: m.annotations,
      meshLabels: m.meshLabels,
      stats: { triangles: m.stats.triangles, meshCount: m.stats.meshCount, totalBytes: m.stats.totalBytes },
    });
    onProgress?.(packageModels.length, models.length, `Collecting ${m.title}`);
  }

  let logo: string | null = null;
  if (config.logoAssetId) {
    const a = await input.readAsset(config.logoAssetId);
    if (a) {
      logo = `branding/logo.${extFor(a.name, a.mime)}`;
      addEntry(logo, a.blob, false);
    }
  }

  const usedRegionIds = new Set(packageModels.flatMap((m) => m.regionIds));
  const usedSystemIds = new Set(packageModels.flatMap((m) => m.systemIds));
  const hashSource = JSON.stringify(packageModels.map((m) => [m.id, m.title, m.annotations.map((a) => [a.id, a.label, a.required])]));
  const contentHash = shortHash(hashSource);
  const content: PackageContent = {
    schema: 1,
    packageId: `${slugify(config.title, 'package')}-${contentHash}`,
    contentHash,
    title: config.title.trim() || 'Anatomy 3D models',
    description: config.description,
    intro: config.intro,
    accent: config.accent,
    logo,
    features: config.features,
    completion: config.completion,
    regions: input.regions.filter((c) => usedRegionIds.has(c.id)),
    systems: input.systems.filter((c) => usedSystemIds.has(c.id)),
    models: packageModels,
    generator: { name: APP_NAME, version: APP_VERSION, builtAt },
  };
  // JSON is valid JavaScript apart from U+2028/2029 in older engines, so escape those explicitly.
  const json = JSON.stringify(content).replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));
  const enc = new TextEncoder();
  addEntry('data/content.js', enc.encode(`window.${CONTENT_GLOBAL}=${json};\n`), true);
  addEntry('index.html', enc.encode(generateLaunchPage(content.title)), true);
  addEntry('assets/player.js', input.player.js, true);
  addEntry('assets/player.css', input.player.css, true);
  if (needsDraco(models)) {
    if (!input.player.draco?.length) throw new PackageBuildError('A selected model uses Draco compression but the decoder files are unavailable.');
    for (const d of input.player.draco) addEntry(`lib/draco/${d.name}`, d.data, /\.js$/.test(d.name));
  }
  const manifestXml = generateManifest12({ identifier: content.packageId, title: content.title, files: listed.map((l) => l.path), launch: 'index.html' });
  const manifestBytes = enc.encode(manifestXml);
  // The manifest must be at the root; put it first so tools that read the archive head find it.
  entries.unshift({ path: 'imsmanifest.xml', data: manifestBytes, compress: true });
  listed.unshift({ path: 'imsmanifest.xml', size: manifestBytes.length });

  const blob = await buildZip(entries, (d, t, p) => onProgress?.(d, t, `Packing ${p}`));
  return { blob, content, manifestXml, files: listed, bytes: blob.size };
}

export { readableTextOn };
