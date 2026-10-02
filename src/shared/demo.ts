import { newId } from './ids';
import { defaultViewSettings, type Annotation, type CameraView, type ModelRecord, type ModelStats } from './types';

/** Shape of public/demo/demo-project.json, produced by scripts/generate-demo-models.ts. */
export interface DemoModelEntry {
  slug: string;
  file: string;
  title: string;
  description: string;
  credit: string;
  regionIds: string[];
  systemIds: string[];
  stats: ModelStats;
  camera: CameraView;
  annotations: Annotation[];
}

export interface DemoProject {
  generatedBy: string;
  licence: string;
  models: DemoModelEntry[];
}

export function demoModelId(slug: string): string {
  return `demo-${slug}`;
}

/** Builds the ModelRecord for a demo model once its files have been stored. */
export function demoEntryToRecord(entry: DemoModelEntry, glbAssetId: string, glbSize: number, thumbnailAssetId: string | null): ModelRecord {
  const now = new Date().toISOString();
  const view = defaultViewSettings();
  view.camera = entry.camera;
  return {
    id: demoModelId(entry.slug),
    title: entry.title,
    description: entry.description,
    credit: entry.credit,
    isDemo: true,
    regionIds: entry.regionIds,
    systemIds: entry.systemIds,
    format: 'glb',
    entryName: entry.file,
    assets: [{ id: glbAssetId, name: entry.file, size: glbSize, mime: 'model/gltf-binary' }],
    thumbnailAssetId,
    stats: { ...entry.stats, totalBytes: glbSize },
    view,
    annotations: entry.annotations.map((a) => ({ ...a })),
    meshLabels: {},
    createdAt: now,
    updatedAt: now,
  };
}

export const newAssetId = () => newId('asset');
