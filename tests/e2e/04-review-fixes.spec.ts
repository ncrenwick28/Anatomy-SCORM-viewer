import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareRoot, serveDirectory } from '../../scripts/serve-package';
import { readZip } from '../../src/shared/zip';
import { makeSameNameTextureGltf } from '../fixtures/makeModels';
import { buildViaUi, card, debugState, gotoApp, importFiles, loadDemo, openModel, OUT, waitSaved, writeFixtures } from './helpers';
import { lmsRoutes } from './lmsHarness';

/** Regression tests for defects found by the independent reviews. */

const HEART = 'Heart (schematic demonstration)';
type S = { models: { id: string; title: string; annotations: { id: string; label: string }[] }[]; save: { state: string } };
const studio = (page: Page) => page.evaluate(() => (window as never as { __ANATOMY_DEBUG__: { studio: () => unknown } }).__ANATOMY_DEBUG__.studio() as never) as Promise<S>;
const heartOf = async (page: Page) => (await studio(page)).models.find((m) => m.title === HEART)!;

test.describe('A-01: backups are always restorable', () => {
  test('an emptied annotation label is replaced, and a backup made from any editor state restores', async ({ browser }) => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    await gotoApp(page);
    await loadDemo(page);
    await openModel(page, HEART);
    await page.locator('.ann-item').first().click();
    await page.getByTestId('annotation-label').fill('');
    await page.getByTestId('annotation-description').focus(); // leaving the field commits the fallback
    await expect(page.locator('.ann-item').first()).toContainText('Annotation 1');
    expect((await heartOf(page)).annotations[0].label).toBe('Annotation 1');
    // Even if an empty label gets into storage by another route, the backup is repaired and restores
    await page.evaluate(() => {
      const st = (window as never as { __ANATOMY_DEBUG__: { studio: () => { models: { id: string; title: string }[]; updateModel: (id: string, fn: (m: unknown) => unknown) => void } } }).__ANATOMY_DEBUG__.studio();
      const heart = st.models.find((m) => m.title.startsWith('Heart'))!;
      st.updateModel(heart.id, (m) => ({ ...(m as object), annotations: (m as { annotations: { label: string }[] }).annotations.map((a, i) => (i === 2 ? { ...a, label: '' } : a)) }));
    });
    await waitSaved(page);
    await page.getByTestId('backup-menu').click();
    const dl = page.waitForEvent('download');
    await page.getByTestId('backup-download').click();
    const path = join(OUT, 'a01-backup.zip');
    await (await dl).saveAs(path);
    await expect(page.getByText(/tidied in the backup copy/)).toBeVisible();

    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await gotoApp(p2);
    await p2.getByTestId('backup-menu').click();
    await p2.getByTestId('backup-restore').click();
    await p2.getByTestId('restore-file').setInputFiles(path);
    await expect(p2.getByRole('dialog')).toContainText('is a valid backup');
    await expect(p2.getByRole('dialog')).not.toContainText('could not'); // the backup was already repaired when it was made
    await p2.getByTestId('restore-confirm').click();
    await expect(p2.getByTestId('model-card')).toHaveCount(4, { timeout: 60_000 });
    const restored = await heartOf(p2);
    expect(restored.annotations.every((a) => a.label.trim().length > 0)).toBe(true);
    await ctx2.close();
    await ctx.close();
  });
});

test.describe('A-02: two tabs cannot silently overwrite each other', () => {
  test('a stale tab refuses to save over newer work, tells the user, and can reload or overwrite', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p1 = await ctx.newPage();
    await gotoApp(p1);
    await loadDemo(p1);
    const p2 = await ctx.newPage();
    await gotoApp(p2);
    await expect(card(p2, HEART)).toBeVisible();
    const before = (await heartOf(p1)).annotations.length;

    // Tab 1 adds an annotation and saves
    await openModel(p1, HEART);
    await p1.getByTestId('add-at-centre').click();
    await p1.getByTestId('annotation-label').fill('Added in tab 1');
    await waitSaved(p1);
    // Tab 2 learns about it straight away
    await expect(p2.getByTestId('stale-banner')).toBeVisible({ timeout: 10_000 });

    // Tab 2 (stale) edits the same model's details and tries to save
    await card(p2, HEART).getByTestId('card-menu').click();
    await p2.getByTestId('card-edit').click();
    await p2.getByLabel('Title').fill('Heart edited in tab 2');
    await p2.getByTestId('model-save').click();
    await expect(p2.getByTestId('conflict-banner')).toBeVisible({ timeout: 15_000 });
    await expect(p2.getByTestId('save-status')).toHaveAttribute('data-state', 'conflict');
    await expect(p2.getByTestId('save-status')).not.toContainText('All changes saved');
    // Nothing was overwritten: tab 1's annotation is still in storage
    const stored = await p1.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open('anatomy-scorm-studio'); r.onsuccess = () => res(r.result); });
      const all = await new Promise<{ title: string; annotations: unknown[] }[]>((res) => { const r = db.transaction('models').objectStore('models').getAll(); r.onsuccess = () => res(r.result); });
      return all.find((m) => m.title.startsWith('Heart'))!;
    });
    expect(stored.annotations.length).toBe(before + 1);
    expect(stored.title).toBe(HEART);

    // Loading the latest brings tab 2 up to date
    await p2.getByTestId('conflict-reload').click();
    await expect(p2.getByRole('alertdialog')).toContainText('Discard the changes made in this tab?');
    await p2.getByRole('button', { name: 'Discard and load the latest' }).click();
    await expect(p2.getByTestId('conflict-banner')).toHaveCount(0);
    expect((await heartOf(p2)).annotations.length).toBe(before + 1);
    await expect(p2.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');

    // After reloading, tab 2 can save normally again
    await card(p2, HEART).getByTestId('card-menu').click();
    await p2.getByTestId('card-edit').click();
    await p2.getByLabel('Title').fill('Heart edited in tab 2');
    await p2.getByTestId('model-save').click();
    await waitSaved(p2);
    expect((await heartOf(p2).catch(() => null)) ?? true).toBeTruthy();

    // Tab 1 is now the stale one; choosing "overwrite" explicitly is possible
    await p1.getByRole('button', { name: 'Library' }).first().click();
    await card(p1, HEART).getByTestId('card-menu').click();
    await p1.getByTestId('card-edit').click();
    await p1.getByLabel('Title').fill('Heart overwritten by tab 1');
    await p1.getByTestId('model-save').click();
    await expect(p1.getByTestId('conflict-banner')).toBeVisible({ timeout: 15_000 });
    await p1.getByTestId('conflict-overwrite').click();
    await expect(p1.getByRole('alertdialog')).toContainText('Overwrite the other tab');
    await p1.getByRole('button', { name: 'Overwrite', exact: true }).click();
    await waitSaved(p1);
    await p2.reload();
    await expect(card(p2, 'Heart overwritten by tab 1')).toBeVisible();
    await ctx.close();
  });
});

test.describe('P-01: an annotation is only "viewed" once its description is shown (annotation list switched off)', () => {
  test('clicking a marker opens the detail panel before counting it', async ({ browser }) => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    await gotoApp(page);
    await loadDemo(page);
    await card(page, HEART).getByTestId('select-model').check();
    await page.goto('/#/export');
    await page.getByTestId('completion-open-all-and-annotations').check();
    await page.getByTestId('feature-annotationList').uncheck();
    await expect(page.getByTestId('feature-selfStudy')).toBeDisabled(); // depends on the list
    await waitSaved(page);
    const zip = await buildViaUi(page, 'p01-package.zip');
    const server = await serveDirectory(await prepareRoot(zip));
    const pp = await ctx.newPage();
    await pp.goto(`http://127.0.0.1:${server.port}/index.html`);
    await pp.locator('.pl-card').first().click();
    await expect(pp.locator('.pl-stage .vp__controls')).toBeVisible({ timeout: 60_000 });
    await expect(pp.locator('.pl-progress__text')).toContainText('0 of 7 annotations viewed');
    await expect.poll(async () => (await debugState(pp)).markers.length).toBeGreaterThan(3);
    const marker = (await debugState(pp)).markers.find((m) => !m.ghost && !m.cluster)!;
    await pp.mouse.click(marker.x!, marker.y!);
    await expect(pp.getByTestId('annotation-detail')).toBeVisible(); // shown even without the list
    await expect(pp.locator('.pl-progress__text')).toContainText('1 of 7 annotations viewed');
    // Switching away from the Annotations tab never counts anything extra
    await pp.getByRole('tab', { name: 'About' }).click();
    await pp.waitForTimeout(500);
    await expect(pp.locator('.pl-progress__text')).toContainText('1 of 7 annotations viewed');
    await server.close();
    await ctx.close();
  });
});

test.describe('A-03: companion files with the same name in different folders', () => {
  test('folder upload keeps the right texture for each part and the package ships both', async ({ browser }) => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    await gotoApp(page);
    await writeFixtures();
    const g = await makeSameNameTextureGltf();
    const dir = join(OUT, 'organ');
    for (const [name, data] of Object.entries(g.resources)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), data);
    }
    writeFileSync(join(dir, g.jsonName), g.gltf);

    // Selecting loose files: two "diffuse.png" cannot be told apart, so the dialog says so
    await importFiles(page, [join(dir, g.jsonName), join(dir, 'organ.bin'), join(dir, 'textures/a/diffuse.png'), join(dir, 'textures/b/diffuse.png')]);
    await expect(page.getByRole('dialog')).toContainText(/Cannot tell which file/);
    await expect(page.getByTestId('import-confirm')).toBeDisabled();
    await page.keyboard.press('Escape');

    // Review A-22: adding the textures in two steps must not let one loose file stand in for both references
    await page.getByTestId('import-open').click();
    await page.getByTestId('import-input').setInputFiles([join(dir, g.jsonName), join(dir, 'organ.bin')]);
    await expect(page.getByRole('dialog')).toContainText('Missing 2 companion files');
    await page.getByTestId('import-input').setInputFiles([join(dir, 'textures/a/diffuse.png')]);
    await expect(page.getByRole('dialog')).toContainText(/Cannot tell which file/);
    await expect(page.getByTestId('import-confirm')).toBeDisabled();
    await page.keyboard.press('Escape');

    // Choosing the folder carries the paths, so each is matched correctly
    await page.getByTestId('import-open').click();
    await page.locator('input[webkitdirectory]').setInputFiles(dir);
    await expect(page.getByTestId('import-confirm')).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByRole('dialog')).not.toContainText('Cannot tell which file');
    await page.getByTestId('import-confirm').click();
    await expect(card(page, 'Organ')).toBeVisible({ timeout: 60_000 });
    await card(page, 'Organ').getByTestId('select-model').check();
    const zip = await buildViaUi(page, 'a03-package.zip');
    const files = await readZip(new Blob([readFileSync(zip)]), { maxTotalBytes: 1e9, maxEntries: 1000 });
    const pngs = [...files.entries()].filter(([n]) => /^models\/.*\.png$/.test(n)).map(([, d]) => Buffer.from(d));
    expect(pngs).toHaveLength(2);
    const a = Buffer.from(g.resources['textures/a/diffuse.png']);
    const b = Buffer.from(g.resources['textures/b/diffuse.png']);
    expect(pngs.some((p) => p.equals(a))).toBe(true);
    expect(pngs.some((p) => p.equals(b))).toBe(true);
    await ctx.close();
  });
});

test.describe('P-02: the LMS is told "incomplete" even if it rejected the first write', () => {
  test('after a failed launch the status is re-sent once the LMS recovers', async ({ browser }) => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    await gotoApp(page);
    await loadDemo(page);
    await card(page, HEART).getByTestId('select-model').check();
    await page.goto('/#/export');
    await page.getByTestId('completion-open-all-and-annotations').check(); // opening the model alone must not complete it
    await waitSaved(page);
    const zip = await buildViaUi(page, 'p02-package.zip');
    const server = await serveDirectory(await prepareRoot(zip), 0, lmsRoutes);
    const pp = await ctx.newPage();
    await pp.goto(`http://127.0.0.1:${server.port}/__lms/harness.html?mode=commitfail`); // failing from the very start
    const sco = pp.frameLocator('#sco');
    await expect(sco.getByTestId('tracking-status')).toHaveAttribute('data-mode', 'lms');
    await sco.locator('.pl-card').first().click();
    await expect(sco.locator('.vp__controls')).toBeVisible({ timeout: 60_000 });
    const status = () => pp.evaluate(() => (window as never as { __lms: { data: Record<string, string> } }).__lms.data['cmi.core.lesson_status']);
    expect(await status()).toBe('not attempted');
    await pp.evaluate(() => ((window as never as { __lms: { failing: boolean } }).__lms.failing = false));
    await expect.poll(status, { timeout: 30_000 }).toBe('incomplete');
    await server.close();
    await ctx.close();
  });
});

test.describe('storage hygiene and workspace details', () => {
  test('orphaned files from an interrupted import are swept at start-up (recent ones are left alone)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await gotoApp(page);
    await loadDemo(page);
    const put = (id: string, createdAt: string) => page.evaluate(async ([assetId, created]) => {
      const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open('anatomy-scorm-studio'); r.onsuccess = () => res(r.result); });
      await new Promise<void>((res) => { const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').put({ id: assetId, name: 'x.bin', mime: 'application/octet-stream', size: 3, blob: new Blob(['abc']), createdAt: created }); tx.oncomplete = () => res(); });
    }, [id, createdAt]);
    await put('orphan-old', '2020-01-01T00:00:00.000Z');
    await put('orphan-recent', new Date().toISOString());
    await page.reload();
    await expect(card(page, HEART)).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open('anatomy-scorm-studio'); r.onsuccess = () => res(r.result); });
      return new Promise<string[]>((res) => { const r = db.transaction('assets').objectStore('assets').getAllKeys(); r.onsuccess = () => res(r.result as string[]); });
    })).toEqual(expect.not.arrayContaining(['orphan-old']));
    const keys = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open('anatomy-scorm-studio'); r.onsuccess = () => res(r.result); });
      return new Promise<string[]>((res) => { const r = db.transaction('assets').objectStore('assets').getAllKeys(); r.onsuccess = () => res(r.result as string[]); });
    });
    expect(keys).toContain('orphan-recent');
    expect(keys.length).toBeGreaterThan(8); // the demo models' files are untouched
    await ctx.close();
  });

  test('the workspace says when the view differs from the saved default, and the toolbar comes first in tab order', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await gotoApp(page);
    await loadDemo(page);
    await openModel(page, HEART);
    await expect(page.locator('.ws-bar__title .hint')).toContainText('Default view saved');
    await page.getByTestId('tab-structures').click();
    await page.getByRole('button', { name: 'Hide Aorta' }).click();
    await expect(page.locator('.ws-bar__title .hint')).toContainText('View differs from the saved default');
    await page.getByRole('button', { name: 'Show all' }).click();
    await expect(page.locator('.ws-bar__title .hint')).toContainText('Default view saved');
    await page.getByRole('button', { name: 'Rotate left' }).click();
    await expect(page.locator('.ws-bar__title .hint')).toContainText('View differs from the saved default');
    // Focus order matches the visual order: annotation toolbar (top) before the view controls (bottom)
    const order = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.ws-stage button'));
      const idx = (re: RegExp) => buttons.findIndex((b) => re.test(b.textContent ?? '') || re.test(b.getAttribute('aria-label') ?? ''));
      return { add: idx(/Add annotation/), rotate: idx(/Rotate left/) };
    });
    expect(order.add).toBeGreaterThanOrEqual(0);
    expect(order.add).toBeLessThan(order.rotate);
    await ctx.close();
  });

  test('accessibility: the export page with warnings listed (scrollable issue list) has no serious problems', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await gotoApp(page);
    const files = await writeFixtures();
    await importFiles(page, [files.glbPath]);
    await page.getByTestId('import-confirm').click();
    await expect(card(page, 'Test femur')).toBeVisible({ timeout: 60_000 });
    await card(page, 'Test femur').getByTestId('select-model').check();
    await page.goto('/#/export');
    await expect(page.getByTestId('issue-list')).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await ctx.close();
  });

  test('a corrupt model (buffer view past the end of the data) is explained in plain language', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await gotoApp(page);
    // A GLB whose JSON declares a buffer view far beyond the binary chunk
    const json = { asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }] };
    let text = JSON.stringify(json);
    while (text.length % 4) text += ' ';
    const jb = new TextEncoder().encode(text);
    const buf = new Uint8Array(12 + 8 + jb.length);
    const v = new DataView(buf.buffer);
    v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, buf.length, true); v.setUint32(12, jb.length, true); v.setUint32(16, 0x4e4f534a, true);
    buf.set(jb, 20);
    const p = join(OUT, 'corrupt-bufferview.glb');
    writeFileSync(p, buf);
    await importFiles(page, [p]);
    await page.getByTestId('import-confirm').click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText(/could not be imported|damaged|could not be displayed/, { timeout: 30_000 });
    await expect(dlg).not.toContainText('Invalid typed array length');
    await expect(page.getByTestId('import-confirm')).toBeDisabled(); // nothing importable remains in the list
    await ctx.close();
  });
});

test.describe('A-21: a single tab never reports a false conflict after a reload', () => {
  test('project changes after one or more reloads are saved normally and nothing is discarded', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await gotoApp(page);
    await loadDemo(page);
    for (let round = 0; round < 3; round++) {
      await page.reload();
      await expect(card(page, HEART)).toBeVisible();
      await card(page, HEART).getByTestId('select-model').click(); // a project-level change (export selection)
      await waitSaved(page);
      await expect(page.getByTestId('conflict-banner')).toHaveCount(0);
      await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    }
    // Annotation work after a reload is kept too
    await page.reload();
    await openModel(page, HEART);
    const before = (await heartOf(page)).annotations.length;
    await page.getByTestId('add-at-centre').click();
    await page.getByTestId('annotation-label').fill('After reload');
    await page.goto('/#/export');
    await page.getByTestId('export-title').fill('Typed after a reload');
    await waitSaved(page);
    await expect(page.getByTestId('conflict-banner')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('export-title')).toHaveValue('Typed after a reload');
    await page.goto('/#/');
    await openModel(page, HEART);
    await expect(page.locator('.ann-item')).toHaveCount(before + 1);
    await ctx.close();
  });
});

test.describe('A-23: models deleted in another tab are not resurrected or duplicated into broken records', () => {
  test('deleting is announced to other tabs, and a stale tab cannot bring back or copy a deleted model', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p1 = await ctx.newPage();
    await gotoApp(p1);
    await loadDemo(p1);
    const p2 = await ctx.newPage();
    await gotoApp(p2);
    await expect(card(p2, 'Knee joint')).toBeVisible();
    // Tab 1 deletes the knee model
    await card(p1, 'Knee joint').getByTestId('card-menu').click();
    await p1.getByTestId('card-delete').click();
    await p1.getByRole('button', { name: 'Delete model' }).click();
    await expect(card(p1, 'Knee joint')).toHaveCount(0);
    await waitSaved(p1);
    await expect(p2.getByTestId('stale-banner')).toBeVisible({ timeout: 10_000 }); // the deletion was announced
    // Tab 2 (stale) tries to duplicate the deleted model: refused, nothing broken is created
    await card(p2, 'Knee joint').getByTestId('card-menu').click();
    await p2.getByTestId('card-duplicate').click();
    await expect(p2.getByText(/deleted in another tab/)).toBeVisible({ timeout: 15_000 });
    await expect(card(p2, 'Knee joint (copy)')).toHaveCount(0); // the broken copy was not kept
    await p2.getByRole('button', { name: 'Reload the latest version' }).click();
    await expect(card(p2, 'Knee joint')).toHaveCount(0); // reloading brings the stale tab up to date
    // Storage holds exactly the three remaining models, and each still has its files
    const check = await p1.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open('anatomy-scorm-studio'); r.onsuccess = () => res(r.result); });
      const get = <T,>(store: string) => new Promise<T[]>((res) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result as T[]); });
      const models = await get<{ title: string; assets: { id: string }[] }[][number]>('models');
      const assets = new Set((await get<{ id: string }>('assets')).map((a) => a.id));
      return { titles: models.map((m) => m.title).sort(), allFilesPresent: models.every((m) => m.assets.every((a) => assets.has(a.id))) };
    });
    expect(check.titles).toHaveLength(3);
    expect(check.titles.some((t) => t.includes('Knee'))).toBe(false);
    expect(check.allFilesPresent).toBe(true);
    await ctx.close();
  });
});

test.describe('P-21: progress kept on a shared computer belongs to one learner', () => {
  test('a second learner does not inherit the first learner\'s completion', async ({ browser }) => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    await gotoApp(page);
    await loadDemo(page);
    await card(page, HEART).getByTestId('select-model').check();
    const zip = await buildViaUi(page, 'p21-package.zip'); // default rule: open every model (one model)
    const server = await serveDirectory(await prepareRoot(zip), 0, lmsRoutes);
    const learnerPage = await ctx.newPage(); // same browser profile = same computer
    await learnerPage.goto(`http://127.0.0.1:${server.port}/__lms/harness.html?mode=ok&student=learner-one`);
    let sco = learnerPage.frameLocator('#sco');
    await sco.locator('.pl-card').first().click();
    await expect(sco.locator('.vp__controls')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => learnerPage.evaluate(() => (window as never as { __lms: { data: Record<string, string> } }).__lms.data['cmi.core.lesson_status']), { timeout: 15_000 }).toBe('completed');
    await learnerPage.goto('about:blank');
    // Learner two, mid-attempt (resume, incomplete) in the same browser
    await learnerPage.goto(`http://127.0.0.1:${server.port}/__lms/harness.html?mode=ok&student=learner-two&entry=resume&status=incomplete`);
    sco = learnerPage.frameLocator('#sco');
    await expect(sco.locator('.pl-card').first()).toBeVisible();
    await expect(sco.locator('.pl-progress__text')).toContainText('0 of 1 models opened');
    await expect(sco.getByText('Completed')).toHaveCount(0);
    await learnerPage.waitForTimeout(1500);
    expect(await learnerPage.evaluate(() => (window as never as { __lms: { data: Record<string, string> } }).__lms.data['cmi.core.lesson_status'])).toBe('incomplete');
    await server.close();
    await ctx.close();
  });
});
