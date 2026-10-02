/**
 * Pure (DOM-free) inspection of glTF/GLB files: header validation, dependency discovery and URI
 * rewriting. Used by the importer and by unit tests, and runs identically in Node and the browser.
 */

export class ModelFileError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ModelFileError';
    this.code = code;
  }
}


export type GltfJson = Record<string, any>;

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;

/** Extensions that GLTFLoader cannot decode in this build when listed as *required*. */
export const UNSUPPORTED_REQUIRED_EXTENSIONS: Record<string, string> = {
  KHR_texture_basisu:
    'it uses KTX2/Basis Universal textures, which this version cannot decode. Re-export the model with PNG, JPEG or WebP textures.',
};
// Draco (KHR_draco_mesh_compression) and Meshopt (EXT_meshopt_compression) are decoded locally and supported.

export interface GltfSummary {
  json: GltfJson;
  extensionsUsed: string[];
  extensionsRequired: string[];
  meshCount: number;
  materialCount: number;
  textureCount: number;
  imageCount: number;
  nodeCount: number;
  /** Non-data URIs that must be supplied as companion files. */
  externalUris: string[];
  /** Absolute / remote URIs, which are refused. */
  remoteUris: string[];
  usesDraco: boolean;
}

/**
 * Validates the first 20 bytes of a GLB (header + JSON chunk header) against the total file size and
 * returns the length of the JSON chunk. Throws ModelFileError with a readable message.
 */
export function parseGlbHeader(head: ArrayBuffer, totalBytes: number): { jsonLength: number } {
  if (totalBytes < 20 || head.byteLength < 20) {
    throw new ModelFileError('glb-too-small', 'This file is too small to be a valid GLB model. It may be empty or truncated.');
  }
  const view = new DataView(head);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new ModelFileError('glb-bad-magic', 'This file does not look like a GLB model (the "glTF" header is missing). Check that it was exported as .glb.');
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new ModelFileError('glb-version', `This GLB uses container version ${version}; only glTF 2.0 (version 2) is supported.`);
  }
  const declared = view.getUint32(8, true);
  if (declared > totalBytes) {
    throw new ModelFileError('glb-truncated', `The file appears to be truncated: it should be ${declared.toLocaleString('en-GB')} bytes but only ${totalBytes.toLocaleString('en-GB')} were received.`);
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON || 20 + jsonLength > totalBytes) {
    throw new ModelFileError('glb-no-json', 'The GLB is damaged: its first data block is not valid glTF JSON.');
  }
  return { jsonLength };
}

/** Parses a .glb held fully in memory and returns its JSON chunk. */
export function readGlb(buffer: ArrayBuffer): GltfJson {
  const { jsonLength } = parseGlbHeader(buffer.slice(0, Math.min(20, buffer.byteLength)), buffer.byteLength);
  const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer, 20, jsonLength));
  return parseGltfText(text);
}

/** Reads and validates only the header and JSON chunk of a (possibly very large) GLB blob. */
export async function readGlbBlob(blob: Blob): Promise<GltfJson> {
  const head = await blob.slice(0, 20).arrayBuffer();
  const { jsonLength } = parseGlbHeader(head, blob.size);
  const text = new TextDecoder('utf-8').decode(await blob.slice(20, 20 + jsonLength).arrayBuffer());
  return parseGltfText(text);
}

export function parseGltfText(text: string): GltfJson {
  let json: GltfJson;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new ModelFileError('json-invalid', 'The model description inside this file is not valid JSON, so the file is damaged or is not a glTF model.');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new ModelFileError('json-invalid', 'This file does not contain a glTF model description.');
  }
  const version = String(json.asset?.version ?? '');
  if (!version.startsWith('2')) {
    throw new ModelFileError('gltf-version', version ? `This model is glTF ${version}; only glTF 2.0 is supported. Re-export it from your modelling tool as glTF 2.0.` : 'This file has no glTF "asset.version", so it cannot be identified as a glTF 2.0 model.');
  }
  return json;
}

function isDataUri(uri: string): boolean {
  return /^data:/i.test(uri);
}

export function summariseGltf(json: GltfJson): GltfSummary {
  const uris: string[] = [];
  const remote: string[] = [];
  const collect = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      const uri = (item as { uri?: unknown })?.uri;
      if (typeof uri !== 'string' || !uri || isDataUri(uri)) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('//')) remote.push(uri);
      else if (!uris.includes(uri)) uris.push(uri);
    }
  };
  collect(json.buffers);
  collect(json.images);
  const extensionsUsed: string[] = Array.isArray(json.extensionsUsed) ? json.extensionsUsed.map(String) : [];
  const extensionsRequired: string[] = Array.isArray(json.extensionsRequired) ? json.extensionsRequired.map(String) : [];
  return {
    json,
    extensionsUsed,
    extensionsRequired,
    meshCount: Array.isArray(json.meshes) ? json.meshes.length : 0,
    materialCount: Array.isArray(json.materials) ? json.materials.length : 0,
    textureCount: Array.isArray(json.textures) ? json.textures.length : 0,
    imageCount: Array.isArray(json.images) ? json.images.length : 0,
    nodeCount: Array.isArray(json.nodes) ? json.nodes.length : 0,
    externalUris: uris,
    remoteUris: remote,
    usesDraco: extensionsUsed.includes('KHR_draco_mesh_compression'),
  };
}

/** Throws if the model cannot be shown by this application. */
export function assertSupported(summary: GltfSummary): void {
  if (summary.remoteUris.length) {
    throw new ModelFileError(
      'remote-uri',
      `This model refers to files on the internet (${summary.remoteUris.slice(0, 2).join(', ')}${summary.remoteUris.length > 2 ? ', …' : ''}). Packages must be self-contained, so re-export the model with its files embedded or supply them as local files.`,
    );
  }
  for (const ext of summary.extensionsRequired) {
    const reason = UNSUPPORTED_REQUIRED_EXTENSIONS[ext];
    if (reason) throw new ModelFileError('unsupported-extension', `This model requires the glTF extension ${ext}, which is not supported: ${reason}`);
  }
  if (!summary.meshCount) {
    throw new ModelFileError('no-meshes', 'This file contains no 3D meshes, so there is nothing to display.');
  }
}

export interface CompanionMatch<T> {
  /** uri (as written in the .gltf) → the supplied file that satisfies it. */
  matched: Record<string, T>;
  missing: string[];
  /** URIs for which more than one supplied file fits and nothing can tell them apart. */
  ambiguous: { uri: string; candidates: string[] }[];
}

function decodeUri(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

/**
 * Matches the external URIs referenced by a .gltf to the files the user supplied.
 *
 * 1. The relative path inside the .gltf is compared with the supplied files' folder paths (folder uploads
 *    carry them), so `textures/a/diffuse.png` and `textures/b/diffuse.png` are told apart.
 * 2. Otherwise the bare file name is used, but only if exactly one supplied file has it. Several files with
 *    the same name and no folder information are reported as ambiguous rather than guessed.
 *
 * The matched *file object* is returned so callers never have to look it up by name again.
 */
export function matchCompanions<T extends { name: string; path?: string }>(uris: string[], supplied: T[]): CompanionMatch<T> {
  const matched: Record<string, T> = {};
  const missing: string[] = [];
  const ambiguous: CompanionMatch<T>['ambiguous'] = [];
  for (const uri of uris) {
    const decoded = normPath(decodeUri(uri));
    const wantedBase = baseName(decoded);
    const byPath = supplied.filter((f) => {
      if (!f.path) return false;
      const fp = normPath(f.path);
      return fp === decoded || fp.endsWith('/' + decoded);
    });
    if (byPath.length === 1) {
      matched[uri] = byPath[0];
      continue;
    }
    if (byPath.length > 1) {
      ambiguous.push({ uri, candidates: byPath.map((f) => f.path ?? f.name) });
      continue;
    }
    const byName = supplied.filter((f) => baseName(f.name).toLowerCase() === wantedBase);
    if (byName.length === 1) matched[uri] = byName[0];
    else if (byName.length > 1) ambiguous.push({ uri, candidates: byName.map((f) => f.path ?? f.name) });
    else missing.push(decodeUri(uri).replace(/^\.\//, ''));
  }
  return { matched, missing, ambiguous };
}

/** Lower-case, ASCII-only, filesystem- and URL-safe file name; unique within `taken`. */
export function sanitiseFileName(name: string, taken: Set<string> = new Set()): string {
  const base = baseName(name);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  let safeStem = stem
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  if (!safeStem) safeStem = 'file';
  let candidate = ext ? `${safeStem}.${ext}` : safeStem;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = ext ? `${safeStem}-${n}.${ext}` : `${safeStem}-${n}`;
    n++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Returns a copy of the glTF JSON with each external URI replaced according to `uriMap`. */
export function rewriteGltfUris(json: GltfJson, uriMap: Record<string, string>): GltfJson {
  const clone: GltfJson = JSON.parse(JSON.stringify(json));
  for (const key of ['buffers', 'images'] as const) {
    if (!Array.isArray(clone[key])) continue;
    for (const item of clone[key]) {
      if (typeof item?.uri === 'string' && uriMap[item.uri] !== undefined) item.uri = uriMap[item.uri];
    }
  }
  return clone;
}

export function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'glb':
      return 'model/gltf-binary';
    case 'gltf':
      return 'model/gltf+json';
    case 'bin':
      return 'application/octet-stream';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

export const MODEL_EXTENSIONS = ['glb', 'gltf'] as const;
export const COMPANION_EXTENSIONS = ['bin', 'png', 'jpg', 'jpeg', 'webp'] as const;
