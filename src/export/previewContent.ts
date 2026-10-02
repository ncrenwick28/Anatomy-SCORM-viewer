import { shortHash } from '../shared/ids';
import type { PackageContent } from '../shared/content';
import type { Category, ExportConfig, ModelRecord } from '../shared/types';
import { APP_NAME, APP_VERSION } from '../shared/version';

/**
 * Builds the same PackageContent the exporter writes, but with `asset:<id>` pseudo-paths so the student
 * player can render straight from browser storage for previews. The player code is identical to the
 * exported one; only the asset resolver differs.
 */
export function buildPreviewContent(config: ExportConfig, regions: Category[], systems: Category[], models: ModelRecord[]): PackageContent {
  return {
    schema: 1,
    packageId: 'preview',
    contentHash: shortHash(JSON.stringify(models.map((m) => [m.id, m.annotations.map((a) => a.id)]))),
    title: config.title.trim() || 'Anatomy 3D models',
    description: config.description,
    intro: config.intro,
    accent: config.accent,
    logo: config.logoAssetId ? `asset:${config.logoAssetId}` : null,
    features: config.features,
    completion: config.completion,
    regions: regions.filter((r) => models.some((m) => m.regionIds.includes(r.id))),
    systems: systems.filter((s) => models.some((m) => m.systemIds.includes(s.id))),
    models: models.map((m) => {
      const files: Record<string, string> = {};
      for (const a of m.assets) files[a.name] = `asset:${a.id}`;
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        credit: m.credit,
        isDemo: m.isDemo,
        regionIds: m.regionIds,
        systemIds: m.systemIds,
        thumbnail: m.thumbnailAssetId ? `asset:${m.thumbnailAssetId}` : '',
        entry: files[m.entryName],
        format: m.format,
        files,
        view: m.view,
        annotations: m.annotations,
        meshLabels: m.meshLabels,
        stats: { triangles: m.stats.triangles, meshCount: m.stats.meshCount, totalBytes: m.stats.totalBytes },
      };
    }),
    generator: { name: APP_NAME, version: APP_VERSION, builtAt: new Date().toISOString() },
  };
}
