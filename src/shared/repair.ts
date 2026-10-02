import { sanitiseUrl } from './richtext';
import { LIMITS } from './types';

/**
 * Repairs recoverable problems in project data (backups and records written by the editor) instead of
 * letting strict validation reject a whole project. It only ever fixes cosmetic violations of the limits
 * in `schema.ts`: empty or over-long text, unusable links. It never invents or discards models, files,
 * annotations or positions. Every repair is reported so the lecturer can be told.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export interface RepairReport {
  warnings: string[];
}

function clamp(o: Obj, key: string, max: number, onClamp?: () => void): void {
  const v = o[key];
  if (typeof v === 'string' && v.length > max) {
    o[key] = v.slice(0, max);
    onClamp?.();
  }
}

/** Repairs one annotation in place. */
export function repairAnnotation(a: Obj, index: number, modelTitle: string, report: RepairReport): void {
  const where = `“${modelTitle}”, annotation ${index + 1}`;
  if (typeof a.label !== 'string' || !a.label.trim()) {
    a.label = `Annotation ${index + 1}`;
    report.warnings.push(`${where} had no label; it was named “Annotation ${index + 1}”.`);
  } else {
    a.label = a.label.trim();
  }
  clamp(a, 'label', LIMITS.maxAnnotationLabel, () => report.warnings.push(`${where}: the label was shortened to ${LIMITS.maxAnnotationLabel} characters.`));
  if (typeof a.description !== 'string') a.description = '';
  clamp(a, 'description', LIMITS.maxAnnotationDescription, () => report.warnings.push(`${where}: the description was shortened to ${LIMITS.maxAnnotationDescription} characters.`));
  if (typeof a.category !== 'string') a.category = '';
  clamp(a, 'category', LIMITS.maxCategory, () => report.warnings.push(`${where}: the category was shortened.`));
  if (a.link !== null && a.link !== undefined) {
    const link = isObj(a.link) ? a.link : null;
    const url = link && typeof link.url === 'string' ? link.url : '';
    if (!link || url.length > 2000 || !sanitiseUrl(url)) {
      a.link = null;
      report.warnings.push(`${where}: the reference link was not a usable http(s) address and was removed.`);
    } else {
      link.url = sanitiseUrl(url);
      if (typeof link.title !== 'string') link.title = '';
      clamp(link, 'title', 120);
    }
  } else {
    a.link = null;
  }
  if (isObj(a.anchor)) clamp(a.anchor, 'meshName', 300);
}

/** Repairs a model record (typed or parsed JSON) in place. */
export function repairModel(m: Obj, report: RepairReport): void {
  if (typeof m.title !== 'string' || !m.title.trim()) {
    m.title = 'Untitled model';
    report.warnings.push('A model had no title and was named “Untitled model”.');
  }
  clamp(m, 'title', LIMITS.maxTitle, () => report.warnings.push(`The title of “${String(m.title)}” was shortened.`));
  if (typeof m.description !== 'string') m.description = '';
  clamp(m, 'description', LIMITS.maxDescription, () => report.warnings.push(`The description of “${String(m.title)}” was shortened.`));
  if (typeof m.credit !== 'string') m.credit = '';
  clamp(m, 'credit', LIMITS.maxCredit);
  const title = String(m.title);
  if (Array.isArray(m.annotations)) m.annotations.forEach((a, i) => isObj(a) && repairAnnotation(a, i, title, report));
  if (isObj(m.meshLabels)) {
    for (const [k, v] of Object.entries(m.meshLabels)) {
      if (typeof v !== 'string' || !v.trim()) delete m.meshLabels[k];
      else m.meshLabels[k] = v.slice(0, 120);
    }
  }
}

/** Repairs a whole backup manifest (parsed JSON) in place. */
export function repairBackupJson(json: unknown): RepairReport {
  const report: RepairReport = { warnings: [] };
  if (!isObj(json)) return report;
  if (Array.isArray(json.models)) json.models.forEach((m) => isObj(m) && repairModel(m, report));
  for (const key of ['regions', 'systems'] as const) {
    const list = json[key];
    if (Array.isArray(list)) {
      list.forEach((c, i) => {
        if (!isObj(c)) return;
        if (typeof c.name !== 'string' || !c.name.trim()) c.name = `Unnamed ${key === 'regions' ? 'region' : 'system'} ${i + 1}`;
        clamp(c, 'name', 60);
      });
    }
  }
  if (isObj(json.exportConfig)) {
    const c = json.exportConfig;
    clamp(c, 'title', LIMITS.maxTitle);
    clamp(c, 'description', LIMITS.maxDescription);
    clamp(c, 'intro', LIMITS.maxDescription);
    if (typeof c.accent === 'string' && !/^#[0-9a-fA-F]{6}$/.test(c.accent)) {
      c.accent = '#0b6e8a';
      report.warnings.push('The package accent colour was invalid and was reset to the default.');
    }
  }
  return report;
}
