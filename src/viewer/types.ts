import type { Annotation, CameraView, ModelStats, Vec3 } from '../shared/types';
import type { StructureNode } from './meshKeys';

/**
 * Where the viewer finds a model's files. `urls` maps each (flat) file name to a loadable URL —
 * a blob: URL in the authoring app, a relative http(s) URL inside an exported package.
 */
export interface ModelSource {
  entryName: string;
  format: 'glb' | 'gltf';
  urls: Record<string, string>;
}

export type LoadStage = 'downloading' | 'parsing' | 'preparing' | 'ready';
export interface LoadProgress {
  stage: LoadStage;
  /** 0–1, or null when unknown. */
  fraction: number | null;
}

export interface LoadedModelInfo {
  stats: Omit<ModelStats, 'totalBytes'>;
  structure: StructureNode[];
  boundsCenter: Vec3;
  boundsSize: Vec3;
}

/**
 * Why a marker is (not) drawn in the viewport.
 *  visible          – drawn normally
 *  occluded         – on a surface facing away or behind other geometry
 *  structure-hidden – its structure has been hidden or isolated away
 *  offscreen        – outside the current view
 */
export type MarkerState = 'visible' | 'occluded' | 'structure-hidden' | 'offscreen';

export interface PickResult {
  anchor: import('../shared/types').AnnotationAnchor;
  /** Client-space position of the pointer. */
  clientX: number;
  clientY: number;
}

export interface ViewerOptions {
  /** URL prefix (ending in "/") of the Draco decoder files. */
  dracoPath?: string;
  /** Called with a human label for a marker (used to conceal names in self-study mode). */
  labelFor?: (a: Annotation, index: number) => string;
  /** Do not attach to DOM size observers; the host calls resize(). Used for off-screen rendering. */
  offscreen?: boolean;
  /** Element that should be made full screen. Defaults to the viewer container. */
  fullscreenTarget?: HTMLElement;
}

export interface ViewerEvents {
  markerClick: { id: string };
  pick: PickResult | null;
  backgroundClick: undefined;
  markerStates: Record<string, MarkerState>;
  cameraMoved: undefined;
  visibility: { hiddenKeys: string[]; isolatedKey: string | null };
  contextLost: undefined;
}

export type { CameraView };
