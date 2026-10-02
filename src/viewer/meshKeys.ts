import * as THREE from 'three';
import type { AnnotationAnchor } from '../shared/types';

/**
 * Stable structure identifiers. A key is the path of child indices from the scene root to the object
 * (e.g. "0/3/1"). Because the model file is stored unchanged and used verbatim in the exported package,
 * the same file always yields the same keys in the authoring app and in the player.
 */
/** Original glTF node name (GLTFLoader sanitises `Object3D.name`, replacing spaces with underscores). */
export function nodeName(obj: THREE.Object3D): string {
  const original = (obj.userData as { name?: unknown } | undefined)?.name;
  return typeof original === 'string' && original ? original : obj.name;
}

export function keyOf(root: THREE.Object3D, obj: THREE.Object3D): string | null {
  const path: number[] = [];
  let cur: THREE.Object3D | null = obj;
  while (cur && cur !== root) {
    const parent: THREE.Object3D | null = cur.parent;
    if (!parent) return null;
    path.push(parent.children.indexOf(cur));
    cur = parent;
  }
  if (cur !== root) return null;
  return path.reverse().join('/');
}

export function findByKey(root: THREE.Object3D, key: string): THREE.Object3D | null {
  if (key === '') return root;
  let cur: THREE.Object3D = root;
  for (const part of key.split('/')) {
    const idx = Number(part);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cur.children.length) return null;
    cur = cur.children[idx];
  }
  return cur;
}

/** Resolves the mesh an annotation is anchored to (key first, then a unique-name fallback). */
export function resolveAnchorMesh(root: THREE.Object3D, anchor: Pick<AnnotationAnchor, 'meshKey' | 'meshName'>): THREE.Mesh | null {
  const byKey = findByKey(root, anchor.meshKey);
  if (byKey && (byKey as THREE.Mesh).isMesh && (!anchor.meshName || nodeName(byKey) === anchor.meshName)) return byKey as THREE.Mesh;
  if (anchor.meshName) {
    const matches: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && nodeName(o) === anchor.meshName) matches.push(o as THREE.Mesh);
    });
    if (matches.length === 1) return matches[0];
  }
  if (byKey && (byKey as THREE.Mesh).isMesh) return byKey as THREE.Mesh;
  return null;
}

/** World position of an anchor, or null if its mesh cannot be found. */
export function anchorToWorld(root: THREE.Object3D, anchor: AnnotationAnchor, out = new THREE.Vector3()): THREE.Vector3 | null {
  const mesh = resolveAnchorMesh(root, anchor);
  if (!mesh) return null;
  mesh.updateWorldMatrix(true, false);
  return out.set(anchor.position[0], anchor.position[1], anchor.position[2]).applyMatrix4(mesh.matrixWorld);
}

export function anchorNormalToWorld(root: THREE.Object3D, anchor: AnnotationAnchor, out = new THREE.Vector3()): THREE.Vector3 | null {
  const mesh = resolveAnchorMesh(root, anchor);
  if (!mesh) return null;
  mesh.updateWorldMatrix(true, false);
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  return out.set(anchor.normal[0], anchor.normal[1], anchor.normal[2]).applyMatrix3(nm).normalize();
}

/** Builds an anchor from a raycast hit. */
export function anchorFromHit(root: THREE.Object3D, hit: THREE.Intersection): AnnotationAnchor | null {
  const mesh = hit.object as THREE.Mesh;
  if (!mesh.isMesh) return null;
  const key = keyOf(root, mesh);
  if (key === null) return null;
  mesh.updateWorldMatrix(true, false);
  const local = mesh.worldToLocal(hit.point.clone());
  const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
  return {
    meshKey: key,
    meshName: nodeName(mesh),
    position: [local.x, local.y, local.z],
    normal: [normal.x, normal.y, normal.z],
  };
}

export interface StructureNode {
  key: string;
  name: string;
  depth: number;
  isMesh: boolean;
  /** Number of meshes in this subtree. */
  meshCount: number;
  children: StructureNode[];
}

/** Builds the structure tree, collapsing nodes that contain no meshes. */
export function buildStructureTree(root: THREE.Object3D): StructureNode[] {
  const build = (obj: THREE.Object3D, depth: number): StructureNode | null => {
    const kids: StructureNode[] = [];
    for (const child of obj.children) {
      const n = build(child, depth + 1);
      if (n) kids.push(n);
    }
    const isMesh = !!(obj as THREE.Mesh).isMesh;
    if (!isMesh && !kids.length) return null;
    const key = keyOf(root, obj);
    if (key === null) return null;
    return {
      key,
      name: nodeName(obj) || (isMesh ? 'Unnamed mesh' : 'Group'),
      depth,
      isMesh,
      meshCount: (isMesh ? 1 : 0) + kids.reduce((s, k) => s + k.meshCount, 0),
      children: kids,
    };
  };
  const top: StructureNode[] = [];
  for (const child of root.children) {
    const n = build(child, 0);
    if (n) top.push(n);
  }
  // Flatten single-child wrapper groups at the top so the list starts with something meaningful.
  while (top.length === 1 && !top[0].isMesh && top[0].children.length) {
    const only = top[0];
    top.splice(0, 1, ...only.children.map((c) => reDepth(c, -1)));
  }
  return top;
}

function reDepth(n: StructureNode, delta: number): StructureNode {
  return { ...n, depth: n.depth + delta, children: n.children.map((c) => reDepth(c, delta)) };
}
