import * as THREE from 'three';
import type { CameraView, Vec3 } from '../shared/types';

/**
 * Computes a camera that frames `box` when looking along `-direction` (the camera sits at
 * `center + direction * distance`). Distance is found by bisection so all eight box corners fit inside
 * `fill` (0–1) of the viewport — tighter and more predictable than a bounding-sphere estimate.
 */
export function frameBox(box: THREE.Box3, direction: THREE.Vector3, fov: number, aspect: number, fill = 0.86): CameraView {
  const center = box.getCenter(new THREE.Vector3());
  const dir = direction.clone().normalize();
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.01, 1e6);
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 1e-6);
  const fits = (d: number): boolean => {
    cam.position.copy(center).addScaledVector(dir, d);
    cam.up.set(0, 1, 0);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    for (const c of corners) {
      const p = c.clone().project(cam);
      if (p.z > 1 || Math.abs(p.x) > fill || Math.abs(p.y) > fill) return false;
    }
    return true;
  };
  let lo = radius * 0.2;
  let hi = radius * 20;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const position = center.clone().addScaledVector(dir, hi);
  cam.position.copy(position);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  const q = cam.quaternion;
  return {
    position: position.toArray() as Vec3,
    target: center.toArray() as Vec3,
    up: [0, 1, 0],
    quaternion: [q.x, q.y, q.z, q.w],
    zoom: 1,
    fov,
    aspect,
  };
}

export const DEFAULT_FOV = 40;
export const DEFAULT_VIEW_DIRECTION = new THREE.Vector3(0.32, 0.2, 1);
