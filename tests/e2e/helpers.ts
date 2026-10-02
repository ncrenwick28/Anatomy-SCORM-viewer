import { expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeGlbBytes, makeGltfFiles } from '../fixtures/makeModels';

export const OUT = join(process.cwd(), 'test-results', 'e2e-files');

export async function writeFixtures() {
  mkdirSync(OUT, { recursive: true });
  const glb = await makeGlbBytes(3);
  const glbPath = join(OUT, 'test-femur.glb');
  writeFileSync(glbPath, glb);
  const truncated = join(OUT, 'truncated.glb');
  writeFileSync(truncated, glb.slice(0, glb.length - 40));
  const notModel = join(OUT, 'not-a-model.glb');
  writeFileSync(notModel, 'this is plain text, not a model');
  const obj = join(OUT, 'heart.obj');
  writeFileSync(obj, 'v 0 0 0\n');
  const g = await makeGltfFiles(2);
  const gltfPath = join(OUT, g.jsonName);
  writeFileSync(gltfPath, g.gltf);
  const companions = Object.entries(g.resources).map(([n, d]) => {
    const p = join(OUT, n);
    writeFileSync(p, d);
    return p;
  });
  return { glbPath, truncated, notModel, obj, gltfPath, companions };
}

export async function gotoApp(page: Page) {
  await page.goto('/');
  await expect(page.locator('.app-header')).toBeVisible();
  await expect(page.getByTestId('save-status')).toBeVisible();
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
}

export async function loadDemo(page: Page) {
  const empty = page.getByTestId('library-empty');
  if (await empty.isVisible().catch(() => false)) {
    await page.getByTestId('load-demo').click();
  } else {
    await page.getByRole('button', { name: /Add the demonstration models/ }).click();
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="model-card"]').length >= 4, null, { timeout: 120_000 });
  await waitSaved(page);
}

export function card(page: Page, title: string | RegExp): Locator {
  return page.locator('[data-testid="model-card"]').filter({ hasText: title });
}

export async function importFiles(page: Page, paths: string[]) {
  await page.getByTestId('import-open').click();
  await page.getByTestId('import-input').setInputFiles(paths);
}

/** Opens a model workspace and waits until the 3D model and markers are ready. */
export async function openModel(page: Page, title: string | RegExp) {
  await card(page, title).getByRole('button', { name: /^Open$/ }).click();
  await expect(page.locator('.ws-stage .vp__controls')).toBeVisible({ timeout: 60_000 });
}

/** Finds a client-space point on the model surface near the middle of the canvas. */
export async function findSurfacePoint(page: Page, nth = 0): Promise<{ x: number; y: number }> {
  const pt = await page.evaluate((n) => {
    const v = (window as unknown as { __ANATOMY_DEBUG__: { primary: () => { canvas: HTMLCanvasElement; pickAt: (x: number, y: number) => unknown } } }).__ANATOMY_DEBUG__.primary();
    const r = v.canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hits: { x: number; y: number }[] = [];
    for (let radius = 0; radius < Math.min(r.width, r.height) / 2 - 20; radius += 12) {
      for (let a = 0; a < 360; a += 20) {
        const x = cx + radius * Math.cos((a * Math.PI) / 180);
        const y = cy + radius * Math.sin((a * Math.PI) / 180);
        if (v.pickAt(x, y) && hits.every((h) => Math.hypot(h.x - x, h.y - y) > 30)) hits.push({ x, y });
        if (hits.length > n) return hits[n];
      }
    }
    return hits[n] ?? null;
  }, nth);
  if (!pt) throw new Error('No point on the model surface found');
  return pt;
}

export async function debugState(page: Page) {
  return page.evaluate(() => {
    const d = (window as unknown as { __ANATOMY_DEBUG__: { viewers: () => unknown[] } }).__ANATOMY_DEBUG__;
    return d.viewers()[0] as {
      camera: { position: number[]; target: number[]; up: number[]; fov: number; aspect: number };
      hiddenKeys: string[];
      isolatedKey: string | null;
      markerStates: Record<string, string>;
      selectedId: string | null;
      markers: { label: string; x: number; y: number; selected: boolean; ghost: boolean; cluster: boolean }[];
      annotationWorld: Record<string, number[] | null>;
      size: { width: number; height: number };
      renderer: { geometries: number; textures: number };
    };
  });
}

export const near = (a: number[], b: number[], tol = 1e-3) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol * Math.max(1, Math.abs(b[i])));

/** Builds the package for the currently selected models through the UI and saves the ZIP. Returns the path. */
export async function buildViaUi(page: Page, fileName: string): Promise<string> {
  await page.goto('/#/export');
  await expect(page.getByTestId('check-summary')).toHaveAttribute('data-errors', '0', { timeout: 30_000 });
  const downloadP = page.waitForEvent('download', { timeout: 180_000 });
  await page.getByTestId('build-package').click();
  const download = await downloadP;
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, fileName);
  await download.saveAs(path);
  return path;
}
