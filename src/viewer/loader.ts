import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import type { LoadProgress, LoadedModelInfo, ModelSource } from './types';
import { buildStructureTree } from './meshKeys';

// Accelerated raycasting (BVH) keeps picking and occlusion tests fast on dense anatomical meshes.
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: unknown }).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: unknown }).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export class ModelLoadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ModelLoadError';
  }
}

const baseName = (u: string) => decodeURIComponent((u.split(/[?#]/)[0] ?? u).split('/').pop() ?? u);

export interface LoadResult {
  root: THREE.Group;
  info: LoadedModelInfo;
  json: Record<string, unknown>;
}

const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

export async function loadModelSource(
  source: ModelSource,
  opts: { dracoPath?: string; onProgress?: (p: LoadProgress) => void; signal?: AbortSignal } = {},
): Promise<LoadResult> {
  const entryUrl = source.urls[source.entryName];
  if (!entryUrl) throw new ModelLoadError(`The model file "${source.entryName}" is missing from storage.`);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('data:')) return url;
    if (url === entryUrl) return url;
    const mapped = source.urls[baseName(url)];
    return mapped ?? url;
  });
  const loader = new GLTFLoader(manager);
  const draco = new DRACOLoader(manager);
  draco.setDecoderPath(opts.dracoPath ?? './lib/draco/');
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  opts.onProgress?.({ stage: 'downloading', fraction: null });
  let gltf: GLTF;
  try {
    gltf = await new Promise<GLTF>((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      loader.load(
        entryUrl,
        resolve,
        (e) => {
          const frac = e.lengthComputable && e.total ? e.loaded / e.total : null;
          opts.onProgress?.({ stage: frac !== null && frac >= 1 ? 'parsing' : 'downloading', fraction: frac });
        },
        reject,
      );
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    throw new ModelLoadError(describeLoadError(err), err);
  } finally {
    draco.dispose();
  }
  const root = gltf.scene;
  // The viewer owns the lighting; discard any lights, cameras and animations authored in the file.
  const toRemove: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) toRemove.push(o);
  });
  toRemove.forEach((o) => o.parent?.remove(o));
  opts.onProgress?.({ stage: 'preparing', fraction: 0 });
  await prepareForRaycast(root, (f) => opts.onProgress?.({ stage: 'preparing', fraction: f }), opts.signal);
  root.updateMatrixWorld(true);
  const info = analyse(root, gltf.parser.json as Record<string, unknown>);
  opts.onProgress?.({ stage: 'ready', fraction: 1 });
  return { root, info, json: gltf.parser.json as Record<string, unknown> };
}

function describeLoadError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch|NetworkError|Load failed|file:/i.test(msg)) {
    return location.protocol === 'file:'
      ? 'The browser blocked loading the model file because this page was opened directly from disk. Open the package through a web server or an LMS (see the README).'
      : 'The model file could not be loaded. Check your connection and try again.';
  }
  if (/Unexpected token|JSON/i.test(msg)) return 'The model file is damaged or is not a valid glTF/GLB file.';
  if (/DRACOLoader|draco/i.test(msg)) return 'The model uses Draco compression but the decoder could not be loaded.';
  return `The model could not be read: ${msg}`;
}

/** Builds BVHs in small time slices so large models do not freeze the interface. */
async function prepareForRaycast(root: THREE.Object3D, onProgress: (f: number) => void, signal?: AbortSignal): Promise<void> {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(m);
  });
  let last = performance.now();
  for (let i = 0; i < meshes.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const g = meshes[i].geometry as THREE.BufferGeometry & { computeBoundsTree?: (o?: object) => void; boundsTree?: unknown };
    if (!g.boundsTree && g.computeBoundsTree) {
      try {
        g.computeBoundsTree({ targetLeafSize: 12 });
      } catch {
        /* fall back to brute-force raycasting for this mesh */
      }
    }
    if (performance.now() - last > 40) {
      onProgress((i + 1) / meshes.length);
      await nextFrame();
      last = performance.now();
    }
  }
  onProgress(1);
}

function analyse(root: THREE.Group, json: Record<string, unknown>): LoadedModelInfo {
  let triangles = 0;
  let vertices = 0;
  let meshCount = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshCount++;
    const pos = m.geometry.getAttribute('position');
    if (pos) {
      vertices += pos.count;
      triangles += m.geometry.index ? m.geometry.index.count / 3 : pos.count / 3;
    }
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      materials.add(mat);
      for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const ext = Array.isArray(json.extensionsUsed) ? (json.extensionsUsed as unknown[]).map(String) : [];
  return {
    stats: {
      triangles: Math.round(triangles),
      vertices,
      meshCount,
      materialCount: materials.size,
      textureCount: textures.size,
      boundsSize: [size.x, size.y, size.z],
      extensionsUsed: ext,
    },
    structure: buildStructureTree(root),
    boundsCenter: [center.x, center.y, center.z],
    boundsSize: [size.x, size.y, size.z],
  };
}

/** Frees GPU and BVH resources held by a model. */
export function disposeModel(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry as THREE.BufferGeometry & { disposeBoundsTree?: () => void };
    g.disposeBoundsTree?.();
    g.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
      mat.dispose();
    }
  });
  textures.forEach((t) => {
    (t as THREE.Texture & { image?: { close?: () => void } }).image?.close?.();
    t.dispose();
  });
}
