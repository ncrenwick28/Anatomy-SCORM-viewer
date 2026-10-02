import { newId } from '../shared/ids';
import {
  ModelFileError,
  assertSupported,
  guessMime,
  matchCompanions,
  parseGltfText,
  readGlbBlob,
  rewriteGltfUris,
  sanitiseFileName,
  summariseGltf,
  type GltfSummary,
} from '../shared/gltfInspect';
import { LIMITS, type AssetRef } from '../shared/types';

/**
 * Turns the files a user selected into validated, normalised model assets.
 *
 * Supported: .glb and .gltf (+ .bin buffers and PNG/JPEG/WebP textures). Everything else is ignored
 * with an explanation. For .gltf, external URIs are rewritten to flat, safe file names so the stored
 * files behave identically wherever they are served from (authoring app, exported package).
 */

export interface ImportInput {
  file: File;
  /** webkitRelativePath for folder uploads. */
  path?: string;
}

export interface ImportCandidate {
  id: string;
  kind: 'glb' | 'gltf';
  entry: ImportInput;
  title: string;
  /** Companion files matched to the .gltf's references. */
  companions: { uri: string; input: ImportInput }[];
  /** Referenced files that were not supplied. */
  missing: string[];
  errors: string[];
  warnings: string[];
  totalBytes: number;
  summary: GltfSummary | null;
}

export interface ImportPlan {
  candidates: ImportCandidate[];
  /** Files that were supplied but are not used (with the reason). */
  ignored: { name: string; reason: string }[];
}

export function humaniseFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return 'Untitled model';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const ext = (n: string) => n.split('.').pop()?.toLowerCase() ?? '';

const UNSUPPORTED_MODEL_FORMATS: Record<string, string> = {
  obj: 'OBJ files are not supported. Convert the model to GLB (for example with Blender: File → Export → glTF 2.0).',
  fbx: 'FBX files are not supported. Convert the model to GLB (for example with Blender or the FBX2glTF tool).',
  stl: 'STL files are not supported. Convert the model to GLB (for example with Blender).',
  ply: 'PLY files are not supported. Convert the model to GLB (for example with Blender or MeshLab).',
  dae: 'COLLADA (.dae) files are not supported. Convert the model to GLB.',
  '3ds': '3DS files are not supported. Convert the model to GLB.',
  blend: 'Blender (.blend) files cannot be imported directly. Export them as GLB first (File → Export → glTF 2.0).',
  usdz: 'USDZ files are not supported. Convert the model to GLB.',
  zip: 'ZIP archives cannot be imported here. Extract it and select the .gltf (with its .bin and texture files) or the .glb.',
};

export async function planImports(inputs: ImportInput[]): Promise<ImportPlan> {
  const ignored: ImportPlan['ignored'] = [];
  const entries: ImportInput[] = [];
  const pool: ImportInput[] = [];
  for (const i of inputs) {
    const e = ext(i.file.name);
    if (e === 'glb' || e === 'gltf') entries.push(i);
    else if (['bin', 'png', 'jpg', 'jpeg', 'webp'].includes(e)) pool.push(i);
    else ignored.push({ name: i.file.name, reason: UNSUPPORTED_MODEL_FORMATS[e] ?? `".${e || '?'}" files are not used. Supported: .glb, .gltf, .bin, .png, .jpg, .webp.` });
  }
  const used = new Set<ImportInput>();
  const candidates: ImportCandidate[] = [];
  for (const entry of entries) {
    const kind = ext(entry.file.name) === 'glb' ? 'glb' : 'gltf';
    const c: ImportCandidate = {
      id: newId('imp'),
      kind,
      entry,
      title: humaniseFileName(entry.file.name),
      companions: [],
      missing: [],
      errors: [],
      warnings: [],
      totalBytes: entry.file.size,
      summary: null,
    };
    try {
      if (!entry.file.size) throw new ModelFileError('empty', 'This file is empty (0 bytes).');
      let json;
      if (kind === 'glb') json = await readGlbBlob(entry.file);
      else json = parseGltfText(await entry.file.text());
      const summary = summariseGltf(json);
      c.summary = summary;
      assertSupported(summary);
      if (kind === 'gltf') {
        const supplied = pool.map((p) => ({ name: p.file.name, path: p.path }));
        const m = matchCompanions(summary.externalUris, supplied);
        c.missing = m.missing;
        for (const [uri, name] of Object.entries(m.matched)) {
          const input = pool.find((p) => p.file.name === name)!;
          c.companions.push({ uri, input });
          used.add(input);
        }
        c.totalBytes += c.companions.reduce((s, x) => s + x.input.file.size, 0);
        if (c.missing.length) c.errors.push(`Missing ${c.missing.length} companion file${c.missing.length > 1 ? 's' : ''}: ${c.missing.slice(0, 6).join(', ')}${c.missing.length > 6 ? ', …' : ''}.`);
      } else if (summary.externalUris.length) {
        c.errors.push(`This GLB refers to external files (${summary.externalUris.slice(0, 3).join(', ')}), which is unusual for .glb. Re-export it with everything embedded.`);
      }
      if (c.totalBytes > LIMITS.modelMaxBytes) c.errors.push(`The model is ${(c.totalBytes / 1048576).toFixed(0)} MB, above the ${(LIMITS.modelMaxBytes / 1048576).toFixed(0)} MB limit. Reduce texture sizes or mesh detail before importing.`);
      else if (c.totalBytes > LIMITS.modelWarnBytes) c.warnings.push(`Large model (${(c.totalBytes / 1048576).toFixed(1)} MB). It will increase package size and may load slowly on tablets and phones; consider optimising it.`);
      if (summary.extensionsUsed.includes('KHR_texture_basisu')) c.warnings.push('This model uses KTX2 textures, which are not displayed in this version.');
    } catch (err) {
      c.errors.push(err instanceof ModelFileError ? err.message : `The file could not be read: ${(err as Error).message}`);
    }
    candidates.push(c);
  }
  for (const p of pool) if (!used.has(p)) ignored.push({ name: p.file.name, reason: 'Not referenced by any selected .gltf file.' });
  if (!entries.length && !inputs.length) ignored.push({ name: '', reason: 'No files selected.' });
  return { candidates, ignored };
}

export interface PreparedAsset {
  ref: AssetRef;
  blob: Blob;
}

export interface PreparedModelFiles {
  entryName: string;
  format: 'glb' | 'gltf';
  assets: PreparedAsset[];
  totalBytes: number;
}

/** Produces flat, safe-named assets, rewriting .gltf URIs accordingly. */
export async function prepareAssets(c: ImportCandidate): Promise<PreparedModelFiles> {
  if (c.errors.length) throw new Error('Cannot prepare a model that has import errors.');
  const taken = new Set<string>();
  const assets: PreparedAsset[] = [];
  const add = (name: string, blob: Blob) => {
    const mime = guessMime(name);
    assets.push({ ref: { id: newId('asset'), name, size: blob.size, mime }, blob: blob.type === mime ? blob : new Blob([blob], { type: mime }) });
    return name;
  };
  const entryName = sanitiseFileName(c.entry.file.name, taken);
  if (c.kind === 'glb') {
    add(entryName, c.entry.file);
  } else {
    const uriMap: Record<string, string> = {};
    for (const comp of c.companions) uriMap[comp.uri] = sanitiseFileName(comp.input.file.name, taken);
    const json = rewriteGltfUris(parseGltfText(await c.entry.file.text()), uriMap);
    add(entryName, new Blob([JSON.stringify(json)], { type: 'model/gltf+json' }));
    for (const comp of c.companions) add(uriMap[comp.uri], comp.input.file);
  }
  return { entryName, format: c.kind, assets, totalBytes: assets.reduce((s, a) => s + a.ref.size, 0) };
}
