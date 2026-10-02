/**
 * Core data model shared by the authoring application, the exporter and the student player.
 * Everything here is plain JSON-serialisable data (no class instances) so it can be stored in
 * IndexedDB, written into project backups and embedded in an exported package unchanged.
 */

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

/** Current schema version of project backups and exported content. Bump on breaking changes. */
export const SCHEMA_VERSION = 1;

/** A saved camera. `aspect` lets the player preserve framing on screens of a different shape. */
export interface CameraView {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  quaternion: Vec4;
  zoom: number;
  fov: number;
  aspect: number;
}

export type BackgroundSetting =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; top: string; bottom: string };

export interface LightingSettings {
  /** Tone-mapping exposure, 0.3 – 2.5. */
  exposure: number;
  /** Ambient/hemisphere fill, 0 – 2. */
  ambient: number;
  /** Key (directional) light intensity, 0 – 4. */
  key: number;
  /** Key light direction in degrees; 0 = from the viewer's left. */
  keyAzimuth: number;
  keyElevation: number;
  /** When true the key light travels with the camera so the visible side is always lit. */
  headlight: boolean;
  /** Soft studio reflections (generated locally; no HDRI download). */
  environment: boolean;
}

export interface ViewSettings {
  camera: CameraView | null;
  background: BackgroundSetting;
  lighting: LightingSettings;
  /** Structure keys hidden in the default view. */
  hiddenMeshKeys: string[];
}

/**
 * Where an annotation is attached. The position and normal are in the *local* space of the mesh
 * identified by `meshKey`, so the marker stays on the structure whatever the camera or the
 * visibility of other structures does.
 */
export interface AnnotationAnchor {
  /** Child-index path from the scene root, e.g. "0/3/1". See viewer/meshKeys.ts. */
  meshKey: string;
  /** Node name at the time of placement; used as a consistency check and for diagnostics. */
  meshName: string;
  position: Vec3;
  normal: Vec3;
}

export interface AnnotationLink {
  url: string;
  title: string;
}

export interface Annotation {
  id: string;
  label: string;
  description: string;
  category: string;
  link: AnnotationLink | null;
  /** Counts towards the "view all required annotations" completion rule. */
  required: boolean;
  anchor: AnnotationAnchor;
  createdAt: string;
  updatedAt: string;
}

export interface AssetRef {
  id: string;
  /** Flat, filesystem-safe file name. For glTF this is also the URI used inside the .gltf. */
  name: string;
  size: number;
  mime: string;
}

export interface ModelStats {
  /** Size of all model files in bytes. */
  totalBytes: number;
  triangles: number;
  vertices: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  boundsSize: Vec3;
  extensionsUsed: string[];
}

export interface ModelRecord {
  id: string;
  title: string;
  description: string;
  /** Attribution / licence text for the 3D model, shown to students. */
  credit: string;
  /** True for the demonstration models shipped with the application. */
  isDemo: boolean;
  regionIds: string[];
  systemIds: string[];
  format: 'glb' | 'gltf';
  /** Name (within `assets`) of the .glb or .gltf file. */
  entryName: string;
  assets: AssetRef[];
  thumbnailAssetId: string | null;
  stats: ModelStats;
  view: ViewSettings;
  annotations: Annotation[];
  /** Optional author-supplied display names for structures (key → name). */
  meshLabels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
}

export type CompletionRule = 'launch' | 'open-all' | 'open-all-and-annotations';

export interface PlayerFeatures {
  search: boolean;
  browseByCategory: boolean;
  annotationList: boolean;
  selfStudy: boolean;
  structureList: boolean;
  fullscreen: boolean;
}

export interface ExportConfig {
  title: string;
  description: string;
  intro: string;
  logoAssetId: string | null;
  accent: string;
  features: PlayerFeatures;
  completion: CompletionRule;
  /** Ordered list of model ids chosen for export. */
  selectedModelIds: string[];
}

export interface Project {
  regions: Category[];
  systems: Category[];
  exportConfig: ExportConfig;
}

export const DEFAULT_LIGHTING: LightingSettings = {
  exposure: 1,
  ambient: 0.55,
  key: 1.6,
  keyAzimuth: -35,
  keyElevation: 40,
  headlight: true,
  environment: true,
};

export const DEFAULT_BACKGROUND: BackgroundSetting = { type: 'gradient', top: '#eef2f6', bottom: '#cfd8e2' };

export function defaultViewSettings(): ViewSettings {
  return {
    camera: null,
    background: { ...DEFAULT_BACKGROUND },
    lighting: { ...DEFAULT_LIGHTING },
    hiddenMeshKeys: [],
  };
}

export const DEFAULT_FEATURES: PlayerFeatures = {
  search: true,
  browseByCategory: true,
  annotationList: true,
  selfStudy: true,
  structureList: true,
  fullscreen: true,
};

export const DEFAULT_ACCENT = '#0b6e8a';

export function defaultExportConfig(): ExportConfig {
  return {
    title: 'Anatomy 3D models',
    description: '',
    intro: '',
    logoAssetId: null,
    accent: DEFAULT_ACCENT,
    features: { ...DEFAULT_FEATURES },
    completion: 'open-all',
    selectedModelIds: [],
  };
}

export const DEFAULT_REGIONS: Category[] = [
  { id: 'region-head-neck', name: 'Head and neck' },
  { id: 'region-thorax', name: 'Thorax' },
  { id: 'region-abdomen', name: 'Abdomen' },
  { id: 'region-pelvis', name: 'Pelvis and perineum' },
  { id: 'region-back', name: 'Back and spine' },
  { id: 'region-upper-limb', name: 'Upper limb' },
  { id: 'region-lower-limb', name: 'Lower limb' },
];

export const DEFAULT_SYSTEMS: Category[] = [
  { id: 'system-skeletal', name: 'Skeletal' },
  { id: 'system-muscular', name: 'Muscular' },
  { id: 'system-cardiovascular', name: 'Cardiovascular' },
  { id: 'system-respiratory', name: 'Respiratory' },
  { id: 'system-digestive', name: 'Digestive' },
  { id: 'system-urinary', name: 'Urinary' },
  { id: 'system-reproductive', name: 'Reproductive' },
  { id: 'system-nervous', name: 'Nervous' },
  { id: 'system-endocrine', name: 'Endocrine' },
  { id: 'system-lymphatic', name: 'Lymphatic and immune' },
  { id: 'system-integumentary', name: 'Integumentary' },
  { id: 'system-special-senses', name: 'Special senses' },
];

/** Hard and soft limits. Soft limits warn; hard limits refuse. */
export const LIMITS = {
  /** Warn when a single model's files exceed this many bytes. */
  modelWarnBytes: 25 * 1024 * 1024,
  /** Refuse single model imports larger than this. */
  modelMaxBytes: 300 * 1024 * 1024,
  /** Warn above this triangle count (rendering may be slow on tablets). */
  trianglesWarn: 1_500_000,
  /** Warn when a package is larger than this many bytes. */
  packageWarnBytes: 150 * 1024 * 1024,
  /** Most LMSs impose their own upload limit; this is only an advisory ceiling. */
  packageMaxBytes: 1024 * 1024 * 1024,
  maxTitle: 120,
  maxDescription: 8000,
  maxAnnotationLabel: 80,
  maxAnnotationDescription: 4000,
  maxCategory: 40,
  maxCredit: 400,
  maxAnnotationsPerModel: 500,
  maxModels: 1000,
  maxLogoBytes: 1024 * 1024,
  maxCompanionFiles: 400,
  /** Maximum total size accepted when restoring a project backup. */
  maxBackupBytes: 2 * 1024 * 1024 * 1024,
} as const;

export const LMS_SUSPEND_DATA_LIMIT = 4096;
