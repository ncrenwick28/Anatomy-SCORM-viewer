import { z } from 'zod';
import { LIMITS, SCHEMA_VERSION } from './types';

/** Runtime validation of imported project data (backups, demo content). */

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const vec3 = z.tuple([finite, finite, finite]);
const vec4 = z.tuple([finite, finite, finite, finite]);
const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour');
const isoDate = z.string().max(40);

export const cameraViewSchema = z.object({
  position: vec3,
  target: vec3,
  up: vec3,
  quaternion: vec4,
  zoom: finite.refine((v) => v > 0, 'zoom must be positive'),
  fov: finite.refine((v) => v > 1 && v < 120, 'fov out of range'),
  aspect: finite.refine((v) => v > 0.1 && v < 10, 'aspect out of range'),
});

export const backgroundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('solid'), color: hexColour }),
  z.object({ type: z.literal('gradient'), top: hexColour, bottom: hexColour }),
]);

export const lightingSchema = z.object({
  exposure: finite.min(0.1).max(4),
  ambient: finite.min(0).max(4),
  key: finite.min(0).max(8),
  keyAzimuth: finite.min(-360).max(360),
  keyElevation: finite.min(-90).max(90),
  headlight: z.boolean(),
  environment: z.boolean(),
});

export const viewSettingsSchema = z.object({
  camera: cameraViewSchema.nullable(),
  background: backgroundSchema,
  lighting: lightingSchema,
  hiddenMeshKeys: z.array(z.string().max(200)).max(5000),
});

const httpUrl = z
  .string()
  .max(2000)
  .refine((u) => {
    try {
      const p = new URL(u).protocol;
      return p === 'http:' || p === 'https:';
    } catch {
      return false;
    }
  }, 'link must be an http(s) URL');

export const annotationSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(LIMITS.maxAnnotationLabel),
  description: z.string().max(LIMITS.maxAnnotationDescription),
  category: z.string().max(LIMITS.maxCategory),
  link: z.object({ url: httpUrl, title: z.string().max(120) }).nullable(),
  required: z.boolean(),
  anchor: z.object({
    meshKey: z.string().min(1).max(200),
    meshName: z.string().max(300),
    position: vec3,
    normal: vec3,
  }),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const assetRefSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/, 'asset names must be flat, safe file names'),
  size: z.number().int().min(0),
  mime: z.string().max(100),
});

export const modelStatsSchema = z.object({
  totalBytes: z.number().min(0),
  triangles: z.number().min(0),
  vertices: z.number().min(0),
  meshCount: z.number().min(0),
  materialCount: z.number().min(0),
  textureCount: z.number().min(0),
  boundsSize: vec3,
  extensionsUsed: z.array(z.string().max(100)).max(100),
});

export const modelRecordSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(LIMITS.maxTitle),
  description: z.string().max(LIMITS.maxDescription),
  credit: z.string().max(LIMITS.maxCredit),
  isDemo: z.boolean(),
  regionIds: z.array(z.string().max(80)).max(50),
  systemIds: z.array(z.string().max(80)).max(50),
  format: z.enum(['glb', 'gltf']),
  entryName: z.string().min(1).max(120),
  assets: z.array(assetRefSchema).min(1).max(LIMITS.maxCompanionFiles + 1),
  thumbnailAssetId: z.string().max(80).nullable(),
  stats: modelStatsSchema,
  view: viewSettingsSchema,
  annotations: z.array(annotationSchema).max(LIMITS.maxAnnotationsPerModel),
  meshLabels: z.record(z.string().max(200), z.string().max(120)),
  createdAt: isoDate,
  updatedAt: isoDate,
  rev: z.string().max(60).optional(),
});

export const categorySchema = z.object({ id: z.string().min(1).max(80), name: z.string().min(1).max(60) });

export const exportConfigSchema = z.object({
  title: z.string().max(LIMITS.maxTitle),
  description: z.string().max(LIMITS.maxDescription),
  intro: z.string().max(LIMITS.maxDescription),
  logoAssetId: z.string().max(80).nullable(),
  accent: hexColour,
  features: z.object({
    search: z.boolean(),
    browseByCategory: z.boolean(),
    annotationList: z.boolean(),
    selfStudy: z.boolean(),
    structureList: z.boolean(),
    fullscreen: z.boolean(),
  }),
  completion: z.enum(['launch', 'open-all', 'open-all-and-annotations']),
  selectedModelIds: z.array(z.string().max(80)).max(LIMITS.maxModels),
});

/** Manifest stored as project.json inside a backup archive. */
export const backupSchema = z.object({
  app: z.literal('anatomy-scorm-studio'),
  schemaVersion: z.number().int().min(1).max(SCHEMA_VERSION),
  exportedAt: isoDate,
  regions: z.array(categorySchema).max(200),
  systems: z.array(categorySchema).max(200),
  exportConfig: exportConfigSchema,
  models: z.array(modelRecordSchema).max(LIMITS.maxModels),
  /** asset id → archive path, and the logo asset if any. */
  assets: z.array(z.object({ id: z.string().max(80), path: z.string().max(300), size: z.number().min(0), mime: z.string().max(100), name: z.string().max(120) })).max(20000),
});

export type BackupManifest = z.infer<typeof backupSchema>;

export function formatZodError(err: z.ZodError, max = 6): string {
  const lines = err.issues.slice(0, max).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  if (err.issues.length > max) lines.push(`…and ${err.issues.length - max} more problems`);
  return lines.join('; ');
}
