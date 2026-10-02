import { expect, test, type Browser, type Page } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareRoot, serveDirectory } from '../../scripts/serve-package';
import { readZip } from '../../src/shared/zip';
import { makePng } from '../fixtures/makeModels';
import { card, debugState, gotoApp, loadDemo, openModel, OUT, waitSaved, writeFixtures } from './helpers';
import { lmsRoutes } from './lmsHarness';

/**
 * Builds a real package through the authoring UI, then tests the exported artifact itself: its files, its
 * student interface, its fidelity to the authoring project, completion, resume and LMS failure handling.
 */

interface Snapshot {
  camera: Record<string, { position: number[]; target: number[]; up: number[]; fov: number; aspect: number }>;
  annotations: Record<string, { id: string; label: string; required: boolean }[]>;
  world: Record<string, Record<string, number[] | null>>;
  ids: Record<string, string>;
}

const snapshot: Snapshot = { camera: {}, annotations: {}, world: {}, ids: {} };
let zipPath = '';
let server: Awaited<ReturnType<typeof serveDirectory>>;
let root = '';
const HEART = 'Heart (schematic demonstration)';
const KNEE = 'Knee joint (schematic demonstration)';
const origin = () => `http://127.0.0.1:${server.port}`;

test.describe.serial('SCORM package: build in the authoring app, then test the exported artifact', () => {
  test.beforeAll(async () => {
    await writeFixtures();
  });
  test.afterAll(async () => server?.close());

  test('7. builds a package containing only the selected models, with branding and options', async ({ browser }) => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
    await gotoApp(page);
    await loadDemo(page);

    // Capture the authoring-side truth for the models that will be exported.
    for (const title of [HEART, KNEE]) {
      await openModel(page, title);
      await expect.poll(async () => Object.keys((await debugState(page)).markerStates).length).toBeGreaterThan(3);
      const dbg = await debugState(page);
      const studio = await page.evaluate(() => (window as never as { __ANATOMY_DEBUG__: { studio: () => { models: { id: string; title: string; view: { camera: unknown }; annotations: { id: string; label: string; required: boolean }[] }[] } } }).__ANATOMY_DEBUG__.studio().models);
      const m = studio.find((x) => x.title === title)!;
      snapshot.ids[title] = m.id;
      snapshot.camera[m.id] = m.view.camera as Snapshot['camera'][string];
      snapshot.annotations[m.id] = m.annotations;
      snapshot.world[m.id] = dbg.annotationWorld;
      await page.getByRole('button', { name: 'Library' }).first().click();
    }

    // Select exactly two of the four models
    await card(page, HEART).getByTestId('select-model').check();
    await card(page, KNEE).getByTestId('select-model').check();
    await expect(page.getByTestId('go-export')).toContainText('2 selected');
    await page.getByTestId('go-export').click();

    await page.getByTestId('export-title').fill('Cardio & knee <demo> "pack"');
    await page.getByLabel(/Short description/).fill('Two schematic models.');
    await page.getByTestId('export-intro').fill('Welcome!\n\n- Rotate **each** model\n- Use self-study mode');
    await page.getByTestId('export-logo').setInputFiles({ name: 'school logo.png', mimeType: 'image/png', buffer: Buffer.from(makePng(64, 32, [20, 90, 160])) });
    await page.getByTestId('export-accent').fill('#1a5fb4');
    await page.getByTestId('completion-open-all-and-annotations').check();
    // Move the knee first, then back (ordering controls)
    await page.getByRole('button', { name: /Move .*Knee.* earlier/ }).click();
    await waitSaved(page);
    await page.getByTestId('full-check').click();
    await expect(page.getByTestId('check-summary')).toHaveAttribute('data-errors', '0', { timeout: 60_000 });

    const downloadP = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('build-package').click();
    const download = await downloadP;
    await expect(page.getByTestId('build-result')).toContainText('Package ready', { timeout: 120_000 });
    mkdirSync(OUT, { recursive: true });
    zipPath = join(OUT, 'e2e-package.zip');
    await download.saveAs(zipPath);
    expect(download.suggestedFilename()).toMatch(/^cardio-knee-demo-pack-scorm12-\d{8}\.zip$/);
    await ctx.close();
  });

  test('7. the ZIP is a valid SCORM 1.2 package with only the selected content and relative paths', async () => {
    const files = await readZip(new Blob([readFileSync(zipPath)]), { maxTotalBytes: 2e9, maxEntries: 5000 });
    const names = [...files.keys()];
    expect(names).toContain('imsmanifest.xml');
    expect(names).toContain('index.html');
    expect(names.filter((n) => n.endsWith('.glb'))).toHaveLength(2);
    expect(names.some((n) => /schematic-(respiratory|vertebral)/.test(n))).toBe(false);
    expect(names.filter((n) => n.startsWith('thumbs/'))).toHaveLength(2);
    expect(names).toContain('branding/logo.png');
    const xml = new TextDecoder().decode(files.get('imsmanifest.xml')!);
    expect(xml).toContain('<schemaversion>1.2</schemaversion>');
    expect(xml).toContain('Cardio &amp; knee &lt;demo&gt; &quot;pack&quot;');
    const listed = [...xml.matchAll(/<file href="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(listed)).toEqual(new Set(names.filter((n) => n !== 'imsmanifest.xml')));
    for (const n of names) expect(/^\/|\.\.|^[a-z]+:/i.test(n)).toBe(false);
    // well-formed XML (parsed with a JavaScript XML parser, so this never silently skips)
    const problems: string[] = [];
    const doc = new DOMParser({ onError: (level: string, msg: string) => problems.push(`${level}: ${msg}`) }).parseFromString(xml, 'text/xml');
    expect(problems).toEqual([]);
    expect(doc.documentElement!.localName).toBe('manifest');
    // No remote references in the launch page or the stylesheet
    for (const n of ['index.html', 'assets/player.css']) expect(new TextDecoder().decode(files.get(n)!)).not.toMatch(/https?:\/\//);
    // The package size is reasonable
    expect(readFileSync(zipPath).length).toBeLessThan(8 * 1024 * 1024);
    root = await prepareRoot(zipPath);
    server = await serveDirectory(root, 0, lmsRoutes);
  });

  test('8. student interface: gallery, search, filters, model view, descriptions (standalone, no LMS)', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(origin()) && !u.startsWith('blob:') && !u.startsWith('data:')) external.push(u);
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Any failed request (a missing texture, model, thumbnail…) fails the test; only the browser's favicon probe is ignored.
    page.on('response', (r) => r.status() >= 400 && !/favicon\.ico$/.test(r.url()) && errors.push(`${r.status()} ${r.url()}`));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(`${origin()}/index.html`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cardio & knee <demo> "pack"');
    await expect(page.locator('.pl-logo')).toBeVisible();
    await expect(page.locator('.pl-card')).toHaveCount(2);
    // The package must not claim LMS tracking without an LMS
    await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-mode', 'standalone');
    await expect(page.getByTestId('tracking-status')).toContainText('not sent to an LMS');
    await expect(page.getByTestId('tracking-status')).not.toContainText('saved to your course');
    // Introduction renders formatted (and escaped) text
    await expect(page.locator('.pl-intro li')).toHaveCount(2);
    // Branding: accent colour applied
    const accent = await page.locator('.pl-app').evaluate((el) => getComputedStyle(el).getPropertyValue('--accent').trim());
    expect(accent).toBe('#1a5fb4');
    // Thumbnails load
    await expect.poll(() => page.locator('.pl-card img').first().evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0))).toBeGreaterThan(100);
    // Search and filters
    await page.getByLabel('Search models').fill('knee');
    await expect(page.locator('.pl-card')).toHaveCount(1);
    await page.getByLabel('Search models').fill('zzzz');
    await expect(page.getByText('No models match.')).toBeVisible();
    await page.getByLabel('Search models').fill('');
    await page.getByRole('button', { name: /^Thorax/ }).click();
    await expect(page.locator('.pl-card')).toHaveCount(1);
    await page.getByRole('button', { name: /^Thorax/ }).click();
    await page.getByRole('button', { name: /^Muscular/ }).click();
    await expect(page.locator('.pl-card')).toHaveCount(1);
    await expect(page.locator('.pl-card')).toContainText('Knee joint');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('.pl-card')).toHaveCount(2);

    // Open a model
    await page.locator('.pl-card', { hasText: 'Heart' }).click();
    await expect(page.locator('.pl-stage .vp__controls')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEART);
    await expect(page.locator('.pl-about')).toContainText('schematic');
    await page.getByRole('tab', { name: /Annotations/ }).click();
    await expect.poll(async () => (await debugState(page)).markers.length).toBeGreaterThanOrEqual(5);

    // Selecting from the list highlights the marker and shows the description without leaving the list
    await page.getByRole('button', { name: /Left ventricle/ }).first().click();
    await expect(page.getByTestId('annotation-detail')).toContainText('thickest-walled chamber');
    await expect.poll(async () => (await debugState(page)).markers.filter((m) => m.selected).length).toBe(1);
    await expect(page.locator('.ann-item')).toHaveCount(7);
    // ...and from the model itself
    const marker = (await debugState(page)).markers.find((m) => /Right atrium/.test(m.label ?? ''))!;
    await page.mouse.click(marker.x!, marker.y!);
    await expect(page.getByTestId('annotation-detail')).toContainText('Right atrium');
    await expect(page.locator('.ann-item.is-selected')).toContainText('Right atrium');
    // Description links open safely in a new tab
    await page.getByRole('button', { name: /Left ventricle/ }).first().click();
    const link = page.getByTestId('annotation-detail').locator('a');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    // Show/hide annotations
    await page.getByRole('button', { name: 'Hide annotations' }).click();
    await expect.poll(async () => (await debugState(page)).markers.length).toBe(0);
    await page.getByRole('button', { name: 'Show annotations' }).click();
    await expect.poll(async () => (await debugState(page)).markers.length).toBeGreaterThan(0);
    // Searchable list
    await page.getByLabel('Search annotations').fill('Superior vena');
    await expect(page.locator('.ann-item')).toHaveCount(1);
    await page.getByLabel('Search annotations').fill('');
    // Self-study conceals names until revealed
    await page.getByRole('switch', { name: /Self-study/ }).click();
    await expect(page.locator('.ann-item').first()).toContainText('Structure 1');
    await expect(page.locator('.ann-item').first()).not.toContainText('Right atrium');
    await page.locator('.ann-item').nth(2).click();
    await expect(page.getByTestId('annotation-detail')).toContainText('hidden for self-study');
    await expect(page.getByTestId('annotation-detail')).not.toContainText('thickest-walled');
    await expect.poll(async () => (await debugState(page)).markers.some((m) => /Left ventricle/.test(m.label ?? ''))).toBe(false);
    await page.getByRole('button', { name: 'Reveal name and description' }).click();
    await expect(page.getByTestId('annotation-detail')).toContainText('Left ventricle');
    await page.getByRole('switch', { name: /Self-study/ }).click();
    // Structure list: isolate a structure and hide another
    await page.getByRole('tab', { name: /Structures/ }).click();
    await page.getByRole('button', { name: 'Isolate Aorta' }).click();
    await expect.poll(async () => (await debugState(page)).isolatedKey).not.toBeNull();
    await page.getByRole('button', { name: 'Show all' }).click();
    await expect.poll(async () => (await debugState(page)).isolatedKey).toBeNull();
    await page.getByRole('button', { name: 'Hide Left ventricle' }).click();
    await expect.poll(async () => (await debugState(page)).hiddenKeys.length).toBe(1);
    // Reset and view controls
    await page.getByRole('button', { name: 'Rotate left' }).click();
    await page.getByRole('button', { name: 'Reset view' }).click();
    // Back to the gallery
    await page.getByRole('button', { name: 'Back to gallery' }).click();
    await expect(page.locator('.pl-card')).toHaveCount(2);
    await expect(page.locator('.pl-card', { hasText: 'Heart' })).toContainText('Opened');
    expect(external, `requests to external hosts: ${external.join(', ')}`).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('9. default views and annotation positions in the package match the authoring project', async ({ page }) => {
    for (const title of [HEART, KNEE]) {
      const id = snapshot.ids[title];
      await page.goto(`${origin()}/index.html#/model/${encodeURIComponent(id)}`);
      await expect(page.locator('.pl-stage .vp__controls')).toBeVisible({ timeout: 60_000 });
      await expect.poll(async () => Object.keys((await debugState(page)).markerStates).length).toBe(snapshot.annotations[id].length);
      const dbg = await debugState(page);
      const saved = snapshot.camera[id];
      // Same target and up; same viewing direction
      for (let i = 0; i < 3; i++) {
        expect(dbg.camera.target[i]).toBeCloseTo(saved.target[i], 3);
        expect(dbg.camera.up[i]).toBeCloseTo(saved.up[i], 3);
      }
      const dir = (c: { position: number[]; target: number[] }) => {
        const d = c.position.map((v, i) => v - c.target[i]);
        const len = Math.hypot(...d);
        return { n: d.map((v) => v / len), len };
      };
      const a = dir(saved);
      const b = dir(dbg.camera);
      for (let i = 0; i < 3; i++) expect(b.n[i]).toBeCloseTo(a.n[i], 3);
      expect(dbg.camera.fov).toBeCloseTo(saved.fov, 3);
      // Distance only differs by the documented aspect-ratio compensation
      const factor = Math.min(Math.max(1, saved.aspect / dbg.camera.aspect), 3);
      expect(b.len / a.len).toBeCloseTo(factor, 2);
      // Annotation world positions are identical to the authoring app's
      for (const [annId, world] of Object.entries(snapshot.world[id])) {
        expect(dbg.annotationWorld[annId], annId).toBeTruthy();
        for (let i = 0; i < 3; i++) expect(dbg.annotationWorld[annId]![i]).toBeCloseTo(world![i], 4);
      }
      expect(Object.keys(dbg.annotationWorld).sort()).toEqual(snapshot.annotations[id].map((x) => x.id).sort());
    }
  });

  test('10a. LMS: completes by the selected rule, writes valid values, terminates cleanly', async ({ page }) => {
    await page.goto(`${origin()}/__lms/harness.html?mode=scorm-again`);
    const sco = page.frameLocator('#sco');
    await expect(sco.locator('.pl-card')).toHaveCount(2, { timeout: 30_000 });
    await expect(sco.getByTestId('tracking-status')).toHaveAttribute('data-mode', 'lms');
    const lms = () => page.evaluate(() => { const l = (window as never as { __lms: { api: { cmi: { core: { lesson_status: string; lesson_location: string }; suspend_data: string } }; writes: Record<string, string>; rejected: string[] } }).__lms; return { status: l.api.cmi.core.lesson_status, location: l.api.cmi.core.lesson_location, suspend: l.api.cmi.suspend_data, writes: l.writes, rejected: l.rejected }; });
    await expect.poll(async () => (await lms()).status).toBe('incomplete');
    // Open model 1 and view every annotation of model 1 only: still incomplete
    for (const [i, title] of ['Knee', 'Heart'].entries()) {
      await sco.locator('.pl-card', { hasText: title }).click();
      await expect(sco.locator('.vp__controls')).toBeVisible({ timeout: 60_000 });
      await sco.getByRole('tab', { name: /Annotations/ }).click();
      const items = sco.locator('.ann-item');
      const n = await items.count();
      for (let k = 0; k < n; k++) {
        await items.nth(k).click();
        await expect(sco.getByTestId('annotation-detail')).toBeVisible();
      }
      if (i === 0) {
        await sco.getByRole('button', { name: 'Back to gallery' }).click();
        expect((await lms()).status).toBe('incomplete');
      }
    }
    await expect.poll(async () => (await lms()).status, { timeout: 10_000 }).toBe('completed');
    const s = await lms();
    expect(s.suspend.length).toBeGreaterThan(5);
    expect(s.suspend.length).toBeLessThanOrEqual(4096);
    expect(s.suspend).toMatch(/^a1\|/);
    expect(s.rejected).toEqual([]);
    expect(s.writes['cmi.core.session_time']).toMatch(/^\d{4}:\d{2}:\d{2}\.\d{2}$/);
    await expect(sco.getByText('Completed').first()).toBeVisible();
    // Leaving the page terminates the session
    await page.goto('about:blank');
  });

  test('10b. LMS: viewing annotations without opening every model does not complete (rule "open all + annotations")', async ({ page }) => {
    await page.goto(`${origin()}/__lms/harness.html?mode=ok`);
    const sco = page.frameLocator('#sco');
    await sco.locator('.pl-card', { hasText: 'Heart' }).click();
    await expect(sco.locator('.vp__controls')).toBeVisible({ timeout: 60_000 });
    await sco.getByRole('tab', { name: /Annotations/ }).click();
    const items = sco.locator('.ann-item');
    for (let k = 0; k < (await items.count()); k++) await items.nth(k).click();
    await page.waitForTimeout(1500);
    const d = await page.evaluate(() => (window as never as { __lms: { data: Record<string, string> } }).__lms.data);
    expect(d['cmi.core.lesson_status']).toBe('incomplete');
    expect(d['cmi.core.lesson_location']).toBe(snapshot.ids[HEART]);
    expect(d['cmi.suspend_data']).toMatch(/^a1\|/);
    // Self-study: an annotation whose name is concealed must NOT count as viewed until it is revealed
    await sco.getByRole('button', { name: 'Back to gallery' }).click();
    await sco.locator('.pl-card', { hasText: 'Knee' }).click();
    await expect(sco.locator('.vp__controls')).toBeVisible({ timeout: 60_000 });
    await sco.getByRole('tab', { name: /Annotations/ }).click();
    const progressText = () => sco.locator('.pl-progress__text').innerText();
    const viewedNow = async () => Number(/(\d+) of \d+ annotations viewed/.exec(await progressText())![1]);
    const before = await viewedNow();
    await sco.getByRole('switch', { name: /Self-study/ }).click();
    await sco.locator('.ann-item').first().click();
    await expect(sco.getByTestId('annotation-detail')).toContainText('hidden for self-study');
    await page.waitForTimeout(1200);
    expect(await viewedNow()).toBe(before); // concealed: not counted
    await sco.getByRole('button', { name: 'Reveal name and description' }).click();
    await expect.poll(viewedNow).toBe(before + 1); // revealed: counted
  });

  test('10c. resume: progress is restored from suspend_data and the learner is offered where they left off', async ({ page }) => {
    // Session 1: open Heart, view two annotations
    await page.goto(`${origin()}/__lms/harness.html?mode=ok`);
    let sco = page.frameLocator('#sco');
    await sco.locator('.pl-card', { hasText: 'Heart' }).click();
    await expect(sco.locator('.vp__controls')).toBeVisible({ timeout: 60_000 });
    await sco.getByRole('tab', { name: /Annotations/ }).click();
    await sco.locator('.ann-item').nth(0).click();
    await sco.locator('.ann-item').nth(1).click();
    await page.waitForTimeout(1500);
    const saved = await page.evaluate(() => (window as never as { __lms: { data: Record<string, string> } }).__lms.data);
    await page.goto('about:blank'); // terminates the session
    // Session 2: relaunch with the stored values, as an LMS does
    const qs = new URLSearchParams({ mode: 'ok', entry: 'resume', status: 'incomplete', suspend: saved['cmi.suspend_data'], location: saved['cmi.core.lesson_location'] });
    await page.goto(`${origin()}/__lms/harness.html?${qs}`);
    sco = page.frameLocator('#sco');
    await expect(sco.getByText(/Welcome back/)).toBeVisible({ timeout: 30_000 });
    await expect(sco.locator('.pl-card', { hasText: 'Heart' })).toContainText('Opened');
    await expect(sco.locator('.pl-card', { hasText: 'Heart' })).toContainText('2/7 viewed');
    await expect(sco.locator('.pl-card', { hasText: 'Knee' })).not.toContainText('Opened');
    await sco.getByRole('button', { name: 'Continue' }).click();
    await expect(sco.getByRole('heading', { level: 1 })).toHaveText(HEART);
    await sco.getByRole('tab', { name: /Annotations/ }).click();
    await expect(sco.locator('.ann-flag--ok')).toHaveCount(2);
  });

  test('10d. LMS failures: no API, failed initialise, failing writes and a throwing LMS never block the learner', async ({ page }) => {
    // No API: honest standalone mode
    await page.goto(`${origin()}/__lms/harness.html?mode=none`);
    let sco = page.frameLocator('#sco');
    await expect(sco.getByTestId('tracking-status')).toHaveAttribute('data-mode', 'standalone');

    // LMSInitialize fails: notice explains, learner continues
    await page.goto(`${origin()}/__lms/harness.html?mode=initfail`);
    sco = page.frameLocator('#sco');
    await expect(sco.getByRole('alert')).toContainText('did not start a tracking session');
    await expect(sco.getByTestId('tracking-status')).toHaveAttribute('data-health', 'degraded');
    await sco.locator('.pl-card', { hasText: 'Heart' }).click();
    await expect(sco.locator('.vp__controls')).toBeVisible({ timeout: 60_000 });

    // An LMS that throws on every call
    await page.goto(`${origin()}/__lms/harness.html?mode=throw`);
    sco = page.frameLocator('#sco');
    await expect(sco.locator('.pl-card')).toHaveCount(2);
    await sco.locator('.pl-card', { hasText: 'Knee' }).click();
    await expect(sco.locator('.vp__controls')).toBeVisible({ timeout: 60_000 });

    // Writes fail mid-session, then the LMS recovers
    await page.goto(`${origin()}/__lms/harness.html?mode=commitfail&failnow=0`);
    sco = page.frameLocator('#sco');
    await expect(sco.getByTestId('tracking-status')).toHaveAttribute('data-mode', 'lms');
    await page.evaluate(() => ((window as never as { __lms: { failing: boolean } }).__lms.failing = true));
    await sco.locator('.pl-card', { hasText: 'Knee' }).click();
    await expect(sco.locator('.vp__controls')).toBeVisible({ timeout: 60_000 });
    await expect(sco.getByRole('alert')).toContainText('could not save your progress', { timeout: 15_000 });
    await expect(sco.getByTestId('tracking-status')).toHaveAttribute('data-health', 'degraded');
    await sco.getByRole('tab', { name: /Annotations/ }).click();
    await sco.locator('.ann-item').first().click(); // the learner can still work
    await expect(sco.getByTestId('annotation-detail')).toBeVisible();
    await page.evaluate(() => ((window as never as { __lms: { failing: boolean } }).__lms.failing = false));
    await expect(sco.getByTestId('tracking-status')).toHaveAttribute('data-health', 'ok', { timeout: 30_000 });
    const d = await page.evaluate(() => (window as never as { __lms: { data: Record<string, string> } }).__lms.data);
    expect(d['cmi.suspend_data']).toMatch(/^a1\|/);
  });

  test('the package works when opened without an LMS and without any server-side help (no external requests)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const external: string[] = [];
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(origin()) || u.startsWith('blob:') || u.startsWith('data:')) return route.continue();
      external.push(u);
      return route.abort();
    });
    await page.goto(`${origin()}/index.html`);
    await page.locator('.pl-card').first().click();
    await expect(page.locator('.pl-stage .vp__controls')).toBeVisible({ timeout: 60_000 });
    expect(external).toEqual([]);
    await ctx.close();
  });
});

export type { Browser, Page };
