import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareRoot, serveDirectory } from '../../scripts/serve-package';
import { readZip } from '../../src/shared/zip';
import { makeDracoGlb } from '../fixtures/makeModels';
import { buildViaUi, card, debugState, findSurfacePoint, gotoApp, importFiles, loadDemo, openModel, OUT, waitSaved, writeFixtures } from './helpers';

const HEART = 'Heart (schematic demonstration)';
const LUNGS = 'Airway and lungs (schematic demonstration)';
const demoContext = async (browser: import('@playwright/test').Browser) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await gotoApp(page);
  await loadDemo(page);
  return { ctx, page };
};
const studioModels = (page: Page) => page.evaluate(() => (window as never as { __ANATOMY_DEBUG__: { studio: () => { models: { id: string; title: string; annotations: { id: string; label: string }[]; view: { hiddenMeshKeys: string[] } }[] } } }).__ANATOMY_DEBUG__.studio().models);

test.describe.serial('viewer behaviour in the authoring app', () => {
  let page: Page;
  let close: () => Promise<void>;
  test.beforeAll(async ({ browser }) => {
    const r = await demoContext(browser);
    page = r.page;
    close = () => r.ctx.close();
  });
  test.afterAll(async () => close());

  test('markers behind geometry are hidden deliberately, shown as ghosts on request, and selecting them turns the model', async () => {
    await openModel(page, HEART);
    await expect.poll(async () => Object.keys((await debugState(page)).markerStates).length).toBe(7);
    const models = await studioModels(page);
    const heart = models.find((m) => m.title === HEART)!;
    const atrium = heart.annotations.find((a) => a.label === 'Left atrium')!;
    let dbg = await debugState(page);
    expect(dbg.markerStates[atrium.id]).toBe('occluded'); // posterior chamber, hidden from the front
    expect(dbg.markers.some((m) => /Left atrium/.test(m.label ?? ''))).toBe(false); // not drawn on the front surface
    expect(dbg.markers.filter((m) => !m.ghost).length).toBe(6);
    // The list tells the learner it is hidden, and "Markers behind" reveals it as a faint dashed ghost
    await expect(page.locator('.ann-item', { hasText: 'Left atrium' })).toContainText('Hidden behind the surface');
    await page.getByRole('button', { name: 'Markers behind' }).click();
    await expect.poll(async () => (await debugState(page)).markers.filter((m) => m.ghost).length).toBe(1);
    await page.getByRole('button', { name: 'Markers behind' }).click();
    // Selecting it from the list turns the model so it can be seen
    const camBefore = (await debugState(page)).camera.position;
    await page.locator('.ann-item', { hasText: 'Left atrium' }).click();
    await expect.poll(async () => (await debugState(page)).markerStates[atrium.id], { timeout: 10_000 }).toBe('visible');
    dbg = await debugState(page);
    expect(dbg.camera.position).not.toEqual(camBefore);
    expect(dbg.markers.filter((m) => m.selected && /Left atrium/.test(m.label ?? ''))).toHaveLength(1);
    // Reset returns to the saved default view
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect.poll(async () => (await debugState(page)).markerStates[atrium.id]).toBe('occluded');
  });

  test('structure list: hide, isolate and show all; hidden structures hide their markers; saved with the default view', async () => {
    await page.getByTestId('tab-structures').click();
    await expect(page.getByRole('list', { name: 'Model structures' })).toBeVisible();
    const lv = (await studioModels(page)).find((m) => m.title === HEART)!.annotations.find((a) => a.label === 'Left ventricle')!;
    await page.getByRole('button', { name: 'Hide Left ventricle' }).click();
    await expect.poll(async () => (await debugState(page)).markerStates[lv.id]).toBe('structure-hidden');
    await page.getByTestId('tab-annotations').click();
    await page.locator('.ann-item', { hasText: 'Left ventricle' }).click();
    await expect(page.getByTestId('annotation-editor')).toContainText('currently hidden');
    await page.getByTestId('tab-structures').click();
    await page.getByRole('button', { name: 'Isolate Aorta' }).click();
    await expect.poll(async () => (await debugState(page)).isolatedKey).not.toBeNull();
    await expect.poll(async () => (await debugState(page)).markers.length).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Show all' }).click();
    await expect.poll(async () => (await debugState(page)).hiddenKeys.length).toBe(0);
    // Hide again, save as default view, reload: the hidden structure persists
    await page.getByRole('button', { name: 'Hide Left ventricle' }).click();
    await page.getByTestId('save-view').click();
    await expect(page.getByText(/Default view saved and thumbnail updated/)).toBeVisible({ timeout: 30_000 });
    await waitSaved(page);
    expect((await studioModels(page)).find((m) => m.title === HEART)!.view.hiddenMeshKeys).toHaveLength(1);
    await page.reload();
    await expect(page.locator('.ws-stage .vp__controls')).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await debugState(page)).hiddenKeys.length).toBe(1);
    await page.getByTestId('tab-structures').click();
    await page.getByRole('button', { name: 'Show Left ventricle' }).click();
    await page.getByTestId('save-view').click();
    await expect(page.getByText(/Default view saved and thumbnail updated/).first()).toBeVisible({ timeout: 30_000 });
  });

  test('crowded markers merge into a "+n" cluster that opens a short list', async () => {
    await page.getByTestId('tab-annotations').click();
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('add-at-centre').click();
      await page.getByTestId('annotation-label').fill(`Crowd ${i + 1}`);
    }
    // Select something else so none of the stacked markers is the (never merged) selected one
    await page.locator('.ann-item', { hasText: 'Right atrium' }).click();
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect.poll(async () => (await debugState(page)).markers.some((m) => m.cluster)).toBe(true);
    const cluster = (await debugState(page)).markers.find((m) => m.cluster)!;
    await page.mouse.click(cluster.x!, cluster.y!);
    const pop = page.getByRole('menu', { name: 'Annotations at this spot' });
    await expect(pop).toBeVisible();
    await pop.getByRole('menuitem').first().click();
    await expect(page.locator('.ann-item.is-selected')).toContainText(/Crowd|ventricle|atrium|artery|trunk|cava|arch/i);
    await expect.poll(async () => (await debugState(page)).markers.filter((m) => m.selected).length).toBe(1);
    // Undo the three additions
    for (let i = 0; i < 3; i++) await page.getByTestId('undo').click();
    await expect(page.locator('.ann-item')).toHaveCount(7);
  });

  test('keyboard: arrow keys rotate the focused model, + zooms, 0 resets, annotation list is arrow-navigable', async () => {
    await page.locator('.ws-stage canvas').focus();
    const a = (await debugState(page)).camera.position;
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await debugState(page)).camera.position).not.toEqual(a);
    const b = (await debugState(page)).camera.position;
    await page.keyboard.press('+');
    await expect.poll(async () => (await debugState(page)).camera.position).not.toEqual(b);
    await page.keyboard.press('0');
    await expect.poll(async () => (await debugState(page)).camera.position.map((v) => +v.toFixed(2))).toEqual(a.map((v) => +v.toFixed(2)));
    await page.locator('.ann-item').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.ann-item').nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ann-item').nth(1)).toHaveAttribute('aria-current', 'true');
  });

  test('3D resources are released when leaving a model (no leaked viewers)', async () => {
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Library' }).first().click();
      await expect.poll(() => page.evaluate(() => (window as never as { __ANATOMY_DEBUG__: { viewers: () => unknown[] } }).__ANATOMY_DEBUG__.viewers().length)).toBe(0);
      await openModel(page, i % 2 ? HEART : LUNGS);
      await expect.poll(() => page.evaluate(() => (window as never as { __ANATOMY_DEBUG__: { viewers: () => unknown[] } }).__ANATOMY_DEBUG__.viewers().length)).toBe(1);
    }
    await page.getByRole('button', { name: 'Library' }).first().click();
    await expect.poll(() => page.evaluate(() => (window as never as { __ANATOMY_DEBUG__: { viewers: () => unknown[] } }).__ANATOMY_DEBUG__.viewers().length)).toBe(0);
  });

  test('student preview mode is separate from authoring and shows the same model', async () => {
    await openModel(page, HEART);
    await page.getByTestId('student-preview').click();
    await expect(page.getByRole('region', { name: 'Preview' })).toContainText('Student preview');
    await expect(page.locator('.pl-stage .vp__controls')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Add annotation' })).toHaveCount(0);
    await expect(page.getByText('Save as default view')).toHaveCount(0);
    await page.getByRole('button', { name: 'Exit preview' }).click();
    await expect(page.getByTestId('add-annotation')).toBeVisible();
  });

  test('backup and restore round-trips the project, and invalid files are explained', async ({ browser }) => {
    await page.goto('/#/');
    const before = await studioModels(page);
    await page.getByTestId('backup-menu').click();
    const dl = page.waitForEvent('download');
    await page.getByTestId('backup-download').click();
    const backupPath = join(OUT, 'e2e-backup.zip');
    await (await dl).saveAs(backupPath);
    expect(readFileSync(backupPath).length).toBeGreaterThan(1000);

    // Restore into a brand-new browser profile (empty storage) in "replace" mode
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await gotoApp(p2);
    await expect(p2.getByTestId('library-empty')).toBeVisible();
    await p2.getByTestId('backup-menu').click();
    await p2.getByTestId('backup-restore').click();
    const bad = join(OUT, 'bad-backup.zip');
    writeFileSync(bad, 'definitely not a zip file');
    await p2.getByTestId('restore-file').setInputFiles(bad);
    await expect(p2.getByRole('dialog')).toContainText(/not a valid ZIP|damaged/);
    await expect(p2.getByTestId('restore-confirm')).toBeDisabled();
    await p2.getByTestId('restore-file').setInputFiles(backupPath);
    await expect(p2.getByRole('dialog')).toContainText('is a valid backup');
    await p2.getByRole('radio', { name: /Replace my current project/ }).check();
    await p2.getByTestId('restore-confirm').click();
    await expect(p2.getByTestId('model-card')).toHaveCount(before.length, { timeout: 60_000 });
    const after = await studioModels(p2);
    expect(after.map((m) => m.title).sort()).toEqual(before.map((m) => m.title).sort());
    for (const m of before) expect(after.find((x) => x.title === m.title)!.annotations.map((a) => a.label)).toEqual(m.annotations.map((a) => a.label));
    // Restored models open and render
    await openModel(p2, HEART);
    await expect.poll(async () => Object.keys((await debugState(p2)).markerStates).length).toBe(7);
    await ctx2.close();
  });
});

test.describe('save failures and unsaved-change warnings', () => {
  test('a failing storage write is reported, retried, and leaving warns about unsaved work', async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      const orig = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: [unknown, IDBValidKey?]) {
        if ((window as never as { __failWrites?: boolean }).__failWrites) throw new DOMException('simulated quota', 'QuotaExceededError');
        return orig.apply(this, args as never);
      };
    });
    const page = await ctx.newPage();
    await gotoApp(page);
    await loadDemo(page);
    await card(page, HEART).getByTestId('card-menu').click();
    await page.getByTestId('card-edit').click();
    await page.evaluate(() => ((window as never as { __failWrites: boolean }).__failWrites = true));
    await page.getByLabel('Title').fill('Heart (edited)');
    await page.getByTestId('model-save').click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
    await expect(page.getByTestId('save-status')).toContainText('Save failed');
    // Leaving while the save is failing triggers the browser's "unsaved changes" prompt (verified at event level:
    // headless Chromium does not surface the native beforeunload dialog).
    const promptWhileFailing = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(promptWhileFailing).toBe(true);
    // The failed edit was never persisted
    const page2 = await ctx.newPage();
    await gotoApp(page2);
    await expect(card(page2, 'Heart (edited)')).toHaveCount(0);
    await expect(card(page2, HEART)).toBeVisible();
    await ctx.close();
  });

  test('recovers when storage works again', async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      const orig = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: [unknown, IDBValidKey?]) {
        if ((window as never as { __failWrites?: boolean }).__failWrites) throw new DOMException('simulated quota', 'QuotaExceededError');
        return orig.apply(this, args as never);
      };
    });
    const page = await ctx.newPage();
    await gotoApp(page);
    await loadDemo(page);
    await page.evaluate(() => ((window as never as { __failWrites: boolean }).__failWrites = true));
    await card(page, HEART).getByTestId('select-model').check();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
    await page.evaluate(() => ((window as never as { __failWrites: boolean }).__failWrites = false));
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
    const promptWhenSaved = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(promptWhenSaved).toBe(false);
    await page.reload();
    await expect(card(page, HEART).getByTestId('select-model')).toBeChecked();
    await ctx.close();
  });
});

test.describe('Draco-compressed models', () => {
  test('import, annotate, export and open from the package (decoder shipped locally)', async ({ browser }) => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await gotoApp(page);
    await writeFixtures();
    const p = join(OUT, 'draco-sphere.glb');
    writeFileSync(p, await makeDracoGlb());
    await importFiles(page, [p]);
    await page.getByTestId('import-confirm').click();
    await expect(card(page, 'Draco sphere')).toBeVisible({ timeout: 60_000 });
    await card(page, 'Draco sphere').getByTestId('select-model').check();
    await openModel(page, 'Draco sphere');
    await page.getByTestId('add-at-centre').click();
    await page.getByTestId('annotation-label').fill('Pole');
    await waitSaved(page);
    const zip = await buildViaUi(page, 'draco-package.zip');
    const files = await readZip(new Blob([readFileSync(zip)]), { maxTotalBytes: 1e9, maxEntries: 1000 });
    expect([...files.keys()]).toEqual(expect.arrayContaining(['lib/draco/draco_decoder.wasm', 'lib/draco/draco_wasm_wrapper.js', 'lib/draco/draco_decoder.js']));
    const root = await prepareRoot(zip);
    const server = await serveDirectory(root);
    const pp = await ctx.newPage();
    const external: string[] = [];
    pp.on('request', (r) => !r.url().startsWith(`http://127.0.0.1:${server.port}`) && !/^(blob|data):/.test(r.url()) && external.push(r.url()));
    pp.on('pageerror', (e) => errors.push(e.message));
    await pp.goto(`http://127.0.0.1:${server.port}/index.html`);
    await pp.locator('.pl-card').first().click();
    await expect(pp.locator('.pl-stage .vp__controls')).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await debugState(pp)).markers.length).toBe(1);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
    await server.close();
    await ctx.close();
  });
});

test.describe('responsive layout', () => {
  test('no horizontal scrolling and usable controls on phone, tablet and desktop widths', async ({ browser }) => {
    const { ctx, page } = await demoContext(browser);
    await card(page, HEART).getByTestId('select-model').check();
    const zipFromPackageSuite = join(OUT, 'e2e-package.zip');
    let server: Awaited<ReturnType<typeof serveDirectory>> | null = null;
    if (existsSync(zipFromPackageSuite)) server = await serveDirectory(await prepareRoot(zipFromPackageSuite));
    const sizes = [{ w: 390, h: 844 }, { w: 820, h: 1180 }, { w: 1280, h: 800 }];
    for (const s of sizes) {
      await page.setViewportSize({ width: s.w, height: s.h });
      const noOverflow = async (label: string) => {
        const { sw, iw, wide } = await page.evaluate(() => {
          const iw = window.innerWidth;
          const wide: string[] = [];
          document.querySelectorAll('body *').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.right > iw + 1 && r.width > 0) wide.push(`${el.tagName}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
          });
          return { sw: document.documentElement.scrollWidth, iw, wide: wide.slice(0, 8) };
        });
        expect(sw, `${label} at ${s.w}px overflows horizontally (${sw} > ${iw}): ${wide.join(' | ')}`).toBeLessThanOrEqual(iw + 1);
      };
      await page.goto('/#/');
      await expect(page.getByTestId('model-card').first()).toBeVisible();
      await noOverflow('library');
      await page.goto('/#/export');
      await expect(page.getByTestId('check-summary')).toBeVisible();
      await noOverflow('export');
      await page.goto('/#/help');
      await noOverflow('help');
      await page.goto('/#/');
      await openModel(page, HEART);
      await noOverflow('workspace');
      await expect(page.getByTestId('add-annotation')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
      if (server) {
        await page.goto(`http://127.0.0.1:${server.port}/index.html`);
        await expect(page.locator('.pl-card').first()).toBeVisible();
        await noOverflow('player gallery');
        await page.locator('.pl-card').first().click();
        await expect(page.locator('.pl-stage .vp__controls')).toBeVisible({ timeout: 60_000 });
        await noOverflow('player model');
        await expect(page.getByRole('button', { name: 'Back to gallery' })).toBeVisible();
        await page.getByRole('tab', { name: /Annotations/ }).click();
        await expect(page.locator('.ann-item').first()).toBeVisible();
      }
    }
    await server?.close();
    await ctx.close();
  });
});

test.describe('accessibility (axe-core)', () => {
  test('no serious or critical violations on the main screens of both deliverables', async ({ browser }) => {
    const { ctx, page } = await demoContext(browser);
    const results: Record<string, { id: string; impact: string; nodes: number; help: string; target: string }[]> = {};
    const scan = async (label: string) => {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      results[label] = r.violations.map((v) => ({ id: v.id, impact: v.impact ?? '', nodes: v.nodes.length, help: v.help, target: String(v.nodes[0]?.target) }));
    };
    await scan('library');
    await page.getByTestId('import-open').click();
    await scan('import dialog');
    await page.keyboard.press('Escape');
    await card(page, HEART).getByTestId('select-model').check();
    await page.goto('/#/export');
    await expect(page.getByTestId('check-summary')).toBeVisible();
    await scan('export');
    await page.goto('/#/help');
    await scan('help');
    await page.goto('/#/');
    await openModel(page, HEART);
    await page.locator('.ann-item').first().click();
    await scan('workspace');
    await page.getByTestId('tab-appearance').click();
    await scan('workspace appearance');
    await page.getByTestId('tab-structures').click();
    await scan('workspace structures');
    // The player (from the package built in the package suite, if present)
    const zip = join(OUT, 'e2e-package.zip');
    if (existsSync(zip)) {
      const server = await serveDirectory(await prepareRoot(zip));
      await page.goto(`http://127.0.0.1:${server.port}/index.html`);
      await expect(page.locator('.pl-card').first()).toBeVisible();
      await scan('player gallery');
      await page.locator('.pl-card').first().click();
      await expect(page.locator('.pl-stage .vp__controls')).toBeVisible({ timeout: 60_000 });
      await scan('player about');
      await page.getByRole('tab', { name: /Annotations/ }).click();
      await page.locator('.ann-item').nth(1).click();
      await scan('player annotations');
      await server.close();
    }
    await ctx.close();
    writeFileSync(join(OUT, 'axe-results.json'), JSON.stringify(results, null, 2));
    const serious = Object.entries(results).flatMap(([screen, vs]) => vs.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${screen}: ${v.id} (${v.impact}) ×${v.nodes} – ${v.help} – ${v.target}`));
    expect(serious, serious.join('\n')).toEqual([]);
    const all = Object.entries(results).flatMap(([screen, vs]) => vs.map((v) => `${screen}: ${v.id} (${v.impact})`));
    console.log('axe (all impacts):', all.length ? all.join('; ') : 'none');
  });
});

export { findSurfacePoint };
