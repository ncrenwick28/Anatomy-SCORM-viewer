import { buildScormPackage, needsDraco, type BuiltPackage, type PlayerAssets } from '../export/buildPackage';
import { runPreflight, type PreflightReport } from '../export/preflight';
import { slugify } from '../shared/ids';
import type { ModelRecord, Project } from '../shared/types';
import { deepCheckAnchors, regenerateThumbnail } from './pipeline';
import { getDb } from './state/db';
import { useStudio } from './state/store';

async function fetchBytes(url: string, what: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (e) {
    throw new Error(`The ${what} could not be loaded (${(e as Error).message}). If you are running from source, run "npm run build:player" first.`);
  }
  if (!res.ok) throw new Error(`The ${what} could not be loaded (HTTP ${res.status}). If you are running from source, run "npm run build:player" first.`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // A single-page-app fallback returns index.html for missing files; never package that by mistake.
  if (bytes[0] === 0x3c && /\.(js|css|wasm)$/.test(url)) throw new Error(`The ${what} is missing from this deployment (the server returned a web page instead). Run "npm run build:player".`);
  return bytes;
}

export async function loadPlayerAssets(withDraco: boolean): Promise<PlayerAssets> {
  const base = import.meta.env.BASE_URL;
  const [js, css] = await Promise.all([fetchBytes(`${base}player/player.js`, 'student player script'), fetchBytes(`${base}player/player.css`, 'student player stylesheet')]);
  const assets: PlayerAssets = { js, css };
  if (withDraco) {
    assets.draco = await Promise.all(['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'].map(async (name) => ({ name, data: await fetchBytes(`${base}lib/draco/${name}`, `Draco decoder (${name})`) })));
  }
  return assets;
}

async function readLogoInfo(): Promise<{ size: number; mime: string } | null> {
  const id = useStudio.getState().project.exportConfig.logoAssetId;
  if (!id) return null;
  const rec = await (await getDb()).getAsset(id);
  return rec ? { size: rec.size, mime: rec.mime } : null;
}

export async function quickPreflight(): Promise<PreflightReport & { models: ModelRecord[] }> {
  const state = useStudio.getState();
  const { project, models } = state;
  const byId = new Map(models.map((m) => [m.id, m]));
  const selected = project.exportConfig.selectedModelIds.map((id) => byId.get(id)).filter((m): m is ModelRecord => !!m);
  const db = await getDb();
  const stored = new Set(await db.listAssetIds());
  const logo = await readLogoInfo();
  return { ...runPreflight({ config: project.exportConfig, models: selected, regions: project.regions, systems: project.systems, storedAssetIds: stored, logo }), models: selected };
}

export interface BuildProgress {
  label: string;
  fraction: number;
}

export interface BuildResult {
  built: BuiltPackage;
  filename: string;
  report: PreflightReport;
}

export class ExportBlockedError extends Error {
  constructor(readonly report: PreflightReport) {
    super('The pre-export checks found problems that must be fixed first.');
  }
}

/** Runs all checks, regenerates any missing thumbnails, builds the SCORM zip. Throws ExportBlockedError on check failures. */
export async function runExport(onProgress: (p: BuildProgress) => void): Promise<BuildResult> {
  const say = (label: string, fraction: number) => onProgress({ label, fraction });
  await useStudio.getState().flush();
  say('Checking the project', 0.02);
  let pre = await quickPreflight();
  // Missing thumbnails are repaired automatically from each model's saved view.
  for (const m of pre.models) {
    const db = await getDb();
    if (!m.thumbnailAssetId || !(await db.getAsset(m.thumbnailAssetId))) {
      say(`Rendering thumbnail for ${m.title}`, 0.05);
      await regenerateThumbnail(m.id);
    }
  }
  pre = await quickPreflight();
  if (!pre.ok) throw new ExportBlockedError(pre);
  say('Verifying annotation positions', 0.1);
  const anchorProblems = await deepCheckAnchors(pre.models, (i, n, t) => say(t ? `Verifying annotations in ${t}` : 'Verified annotations', 0.1 + (i / Math.max(1, n)) * 0.25));
  const state = useStudio.getState();
  const db = await getDb();
  const stored = new Set(await db.listAssetIds());
  const report = runPreflight({ config: state.project.exportConfig, models: pre.models, regions: state.project.regions, systems: state.project.systems, storedAssetIds: stored, anchorProblems, logo: await readLogoInfo() });
  if (!report.ok) throw new ExportBlockedError(report);
  const project: Project = state.project;
  const models = project.exportConfig.selectedModelIds.map((id) => useStudio.getState().models.find((m) => m.id === id)!).filter(Boolean);
  say('Loading the student player', 0.4);
  const player = await loadPlayerAssets(needsDraco(models));
  const built = await buildScormPackage(
    {
      config: project.exportConfig,
      regions: project.regions,
      systems: project.systems,
      models,
      player,
      readAsset: async (id) => {
        const rec = await db.getAsset(id);
        return rec ? { name: rec.name, blob: rec.blob, mime: rec.mime } : undefined;
      },
    },
    (d, t, label) => say(label, 0.45 + (d / Math.max(1, t)) * 0.5),
  );
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  say('Done', 1);
  return { built, filename: `${slugify(project.exportConfig.title, 'anatomy-package')}-scorm12-${stamp}.zip`, report };
}
