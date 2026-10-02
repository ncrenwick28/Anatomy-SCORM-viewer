import { contrastRatio, isValidHex } from '../shared/color';
import { sanitiseUrl } from '../shared/richtext';
import { LIMITS, type Category, type ExportConfig, type ModelRecord } from '../shared/types';

export type IssueLevel = 'error' | 'warning' | 'info';

export interface PreflightIssue {
  level: IssueLevel;
  code: string;
  message: string;
  modelId?: string;
  /** Optional hint on how to fix it. */
  fix?: string;
}

export interface PreflightInput {
  config: ExportConfig;
  /** Selected models in order. */
  models: ModelRecord[];
  regions: Category[];
  systems: Category[];
  /** Ids of assets that exist in storage. */
  storedAssetIds: Set<string>;
  /** Result of the optional deep anchor check, keyed by model id then annotation id. */
  anchorProblems?: Record<string, { annotationId: string; label: string; reason: string }[]>;
  logo?: { size: number; mime: string } | null;
}

export interface PreflightReport {
  issues: PreflightIssue[];
  errors: number;
  warnings: number;
  estimatedBytes: number;
  ok: boolean;
}

export function runPreflight(input: PreflightInput): PreflightReport {
  const { config, models } = input;
  const issues: PreflightIssue[] = [];
  const add = (level: IssueLevel, code: string, message: string, modelId?: string, fix?: string) => issues.push({ level, code, message, modelId, fix });

  if (!models.length) add('error', 'no-models', 'No models are selected for export.', undefined, 'Select models in the library using the checkboxes.');
  if (!config.title.trim()) add('error', 'no-title', 'The package needs a title.', undefined, 'Enter a title in the package settings.');
  if (!isValidHex(config.accent)) add('error', 'bad-accent', 'The accent colour is not a valid colour.');
  else if (contrastRatio(config.accent, '#ffffff') < 3) add('info', 'light-accent', 'The accent colour is very light; the player automatically darkens it where it is used for text.');
  if (config.features.selfStudy && !config.features.annotationList) add('error', 'selfstudy-needs-list', 'Self-study mode needs the annotation list to be enabled.', undefined, 'Enable the annotation list or switch off self-study.');
  if (input.logo) {
    if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(input.logo.mime)) add('error', 'logo-type', 'The logo must be a PNG, JPEG, WebP, GIF or SVG image.');
    if (input.logo.size > LIMITS.maxLogoBytes) add('error', 'logo-size', `The logo is larger than ${(LIMITS.maxLogoBytes / 1048576).toFixed(0)} MB.`);
  } else if (config.logoAssetId) {
    add('error', 'logo-missing', 'The chosen logo is missing from storage.', undefined, 'Upload the logo again or remove it.');
  }

  const seenTitles = new Map<string, number>();
  let estimated = 0;
  let totalRequired = 0;
  const regionIds = new Set(input.regions.map((r) => r.id));
  const systemIds = new Set(input.systems.map((r) => r.id));
  for (const m of models) {
    for (const a of m.assets) {
      estimated += a.size;
      if (!input.storedAssetIds.has(a.id)) add('error', 'missing-file', `"${m.title}": the stored file ${a.name} is missing.`, m.id, 'Re-import the model or restore a backup.');
    }
    if (!m.assets.some((a) => a.name === m.entryName)) add('error', 'missing-entry', `"${m.title}": the main model file is not recorded.`, m.id);
    if (!m.thumbnailAssetId || !input.storedAssetIds.has(m.thumbnailAssetId)) add('warning', 'no-thumbnail', `"${m.title}": no thumbnail is stored. One will be generated from the default view during export.`, m.id);
    else estimated += 60_000;
    if (!m.title.trim()) add('error', 'no-model-title', 'A selected model has no title.', m.id);
    const tkey = m.title.trim().toLowerCase();
    seenTitles.set(tkey, (seenTitles.get(tkey) ?? 0) + 1);
    if (!m.description.trim()) add('warning', 'no-description', `"${m.title}": no description. Students will see an empty About panel.`, m.id, 'Add a description in the model details.');
    if (!m.regionIds.length && !m.systemIds.length) add('warning', 'uncategorised', `"${m.title}" has no body region or system, so it will only appear under "All models".`, m.id);
    for (const r of m.regionIds) if (!regionIds.has(r)) add('warning', 'unknown-region', `"${m.title}" refers to a body region that no longer exists.`, m.id);
    for (const s of m.systemIds) if (!systemIds.has(s)) add('warning', 'unknown-system', `"${m.title}" refers to a body system that no longer exists.`, m.id);
    if (!m.view.camera) add('warning', 'no-default-view', `"${m.title}": no default view has been saved, so students will see an automatic framing.`, m.id, 'Open the model, arrange the view and choose "Save as default view".');
    if (m.stats.totalBytes > LIMITS.modelWarnBytes) add('warning', 'large-model', `"${m.title}" is ${(m.stats.totalBytes / 1048576).toFixed(1)} MB, which may load slowly for students.`, m.id);
    if (m.stats.triangles > LIMITS.trianglesWarn) add('warning', 'heavy-geometry', `"${m.title}" has ${m.stats.triangles.toLocaleString('en-GB')} triangles; tablets may render it slowly.`, m.id);
    const labels = new Set<string>();
    for (const a of m.annotations) {
      if (a.required) totalRequired++;
      if (!a.label.trim()) add('error', 'annotation-no-label', `"${m.title}": an annotation has no label.`, m.id);
      if (a.link && !sanitiseUrl(a.link.url)) add('error', 'annotation-bad-link', `"${m.title}", "${a.label}": the link is not a valid http(s) address.`, m.id, 'Edit the annotation and correct or remove the link.');
      const key = a.label.trim().toLowerCase();
      if (labels.has(key)) add('warning', 'duplicate-label', `"${m.title}": two annotations are both labelled "${a.label}".`, m.id);
      labels.add(key);
    }
    for (const p of input.anchorProblems?.[m.id] ?? []) {
      add('error', 'anchor-problem', `"${m.title}", "${p.label}": ${p.reason}`, m.id, 'Open the model and reposition this annotation, or delete it.');
    }
  }
  for (const [title, n] of seenTitles) if (n > 1 && title) add('warning', 'duplicate-title', `${n} selected models share the title "${title}".`);
  if (config.completion === 'open-all-and-annotations' && models.length && totalRequired === 0) {
    add('warning', 'no-required-annotations', 'The completion rule requires viewing annotations, but no selected model has any required annotation. It will behave like "open every model".');
  }
  if (estimated > LIMITS.packageMaxBytes) add('error', 'package-too-large', `The package would be about ${(estimated / 1048576).toFixed(0)} MB, above the ${(LIMITS.packageMaxBytes / 1048576).toFixed(0)} MB ceiling.`, undefined, 'Remove models or optimise their textures.');
  else if (estimated > LIMITS.packageWarnBytes) add('warning', 'package-large', `The package will be roughly ${(estimated / 1048576).toFixed(0)} MB. Check your LMS's upload limit before uploading.`);
  if (models.some((m) => m.stats.extensionsUsed.includes('KHR_draco_mesh_compression'))) add('info', 'draco', 'A selected model uses Draco compression; the decoder (about 0.6 MB) is included in the package.');

  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;
  const rank = { error: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => rank[a.level] - rank[b.level]);
  return { issues, errors, warnings, estimatedBytes: estimated + 900_000, ok: errors === 0 };
}
