import type { Annotation, Category, CompletionRule, PlayerFeatures, ViewSettings } from './types';

/**
 * The data file embedded in an exported package (data/content.js assigns it to
 * `window.__ANATOMY_CONTENT__`). This is the only contract between the exporter and the player.
 */
export interface PackageModel {
  id: string;
  title: string;
  description: string;
  credit: string;
  isDemo: boolean;
  regionIds: string[];
  systemIds: string[];
  /** Relative paths inside the package. */
  thumbnail: string;
  entry: string;
  format: 'glb' | 'gltf';
  /** Every file of the model, relative to the package root, keyed by its flat file name. */
  files: Record<string, string>;
  view: ViewSettings;
  annotations: Annotation[];
  meshLabels: Record<string, string>;
  stats: { triangles: number; meshCount: number; totalBytes: number };
}

export interface PackageContent {
  schema: 1;
  packageId: string;
  /** Changes whenever models or annotations change; guards saved LMS progress against mismatches. */
  contentHash: string;
  title: string;
  description: string;
  intro: string;
  accent: string;
  logo: string | null;
  features: PlayerFeatures;
  completion: CompletionRule;
  regions: Category[];
  systems: Category[];
  models: PackageModel[];
  generator: { name: string; version: string; builtAt: string };
}

export const CONTENT_GLOBAL = '__ANATOMY_CONTENT__';
