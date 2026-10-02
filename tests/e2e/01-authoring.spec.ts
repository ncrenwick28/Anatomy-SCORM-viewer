import { expect, test, type Page } from '@playwright/test';
import { card, debugState, findSurfacePoint, gotoApp, importFiles, openModel, waitSaved, writeFixtures } from './helpers';

type Studio = { models: { id: string; title: string; regionIds: string[]; systemIds: string[]; thumbnailAssetId: string | null; view: { camera: { position: number[]; target: number[] } | null; background: unknown; lighting: { exposure: number } }; annotations: { id: string; label: string; description: string; category: string; link: { url: string } | null; anchor: { meshKey: string; position: number[]; normal: number[] } }[] }[] };
const studio = (page: Page) => page.evaluate(() => (window as unknown as { __ANATOMY_DEBUG__: { studio: () => unknown } }).__ANATOMY_DEBUG__.studio() as never) as Promise<Studio>;
const model = async (page: Page, title: string) => (await studio(page)).models.find((m) => m.title === title)!;

let files: Awaited<ReturnType<typeof writeFixtures>>;
test.beforeAll(async () => {
  files = await writeFixtures();
});

test.describe.serial('authoring journey', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
    page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  });
  test.afterAll(async () => page.context().close());

  test('shows a helpful empty state', async () => {
    await gotoApp(page);
    await expect(page.getByTestId('library-empty')).toContainText('Your library is empty');
    await expect(page.getByTestId('import-open')).toBeVisible();
  });

  test('1. rejects invalid files with understandable messages and explains unsupported formats', async () => {
    await importFiles(page, [files.truncated, files.notModel, files.obj]);
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('appears to be truncated');
    await expect(dlg).toContainText('does not look like a GLB');
    await expect(dlg).toContainText(/OBJ files are not supported/);
    await expect(page.getByTestId('import-confirm')).toBeDisabled();
    await page.keyboard.press('Escape');
  });

  test('1. reports missing glTF companion files, then imports once they are supplied', async () => {
    await importFiles(page, [files.gltfPath]);
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('Missing 2 companion files');
    await expect(page.getByTestId('import-confirm')).toBeDisabled();
    await page.getByTestId('import-input').setInputFiles(files.companions);
    await expect(dlg).not.toContainText('Missing');
    await expect(page.getByTestId('import-confirm')).toBeEnabled();
    await page.getByTestId('import-confirm').click();
    await expect(card(page, 'Knee model')).toBeVisible({ timeout: 60_000 });
    await waitSaved(page);
    const m = await model(page, 'Knee model');
    expect(m).toBeTruthy();
  });

  test('1 + 2. imports a GLB, shows progress, and assigns several regions and systems', async () => {
    await importFiles(page, [files.glbPath]);
    await expect(page.getByRole('dialog')).toContainText('test-femur.glb');
    await page.getByTestId('import-input'); // dialog stays open
    await page.locator('#imp-region-region-lower-limb').check();
    await page.locator('#imp-region-region-back').check();
    await page.locator('#imp-system-system-skeletal').check();
    await page.getByRole('textbox', { name: /Title for test-femur.glb/ }).fill('Femur test model');
    await page.getByTestId('import-confirm').click();
    await expect(card(page, 'Femur test model')).toBeVisible({ timeout: 60_000 });
    await waitSaved(page);
    const m = await model(page, 'Femur test model');
    expect(m.regionIds.sort()).toEqual(['region-back', 'region-lower-limb']);
    expect(m.thumbnailAssetId).toBeTruthy();
    // Chips are visible on the card
    await expect(card(page, 'Femur test model')).toContainText('Lower limb');
    await expect(card(page, 'Femur test model')).toContainText('Back and spine');
  });

  test('2. edits details with several systems and shows file information', async () => {
    await card(page, 'Femur test model').getByTestId('card-menu').click();
    await page.getByTestId('card-edit').click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Description', { exact: true }).fill('A **test** femur.\n\n- bullet one\n- bullet two <script>alert(1)</script>');
    await dlg.getByRole('button', { name: 'Preview' }).click();
    await expect(dlg.locator('.rich-preview li')).toHaveCount(2);
    await expect(dlg.locator('.rich-preview script')).toHaveCount(0);
    await expect(dlg.locator('.rich-preview')).toContainText('<script>alert(1)</script>');
    await dlg.locator('#mf-system-system-muscular').check();
    await dlg.locator('#mf-system-system-nervous').check();
    await dlg.getByText('File information').click();
    await expect(dlg).toContainText('test-femur.glb');
    await expect(dlg).toContainText('triangles');
    await dlg.getByTestId('model-save').click();
    await waitSaved(page);
    const m = await model(page, 'Femur test model');
    expect(m.systemIds.sort()).toEqual(['system-muscular', 'system-nervous', 'system-skeletal']);
  });

  test('2. requires a title and warns before discarding edits', async () => {
    await card(page, 'Femur test model').getByTestId('card-menu').click();
    await page.getByTestId('card-edit').click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Title').fill('');
    await dlg.getByTestId('model-save').click();
    await expect(dlg).toContainText('Enter a title');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Discard your changes?');
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(dlg).toBeHidden();
    expect((await model(page, 'Femur test model')).title).toBe('Femur test model');
  });

  test('3. creates, edits, moves and deletes annotations, with undo/redo', async () => {
    await openModel(page, 'Femur test model');
    // Create by clicking the surface
    await page.getByTestId('add-annotation').click();
    await expect(page.getByTestId('mode-banner')).toContainText('Click on the model');
    const p1 = await findSurfacePoint(page, 0);
    await page.mouse.click(p1.x, p1.y);
    await expect(page.getByTestId('annotation-editor')).toBeVisible();
    await page.getByTestId('annotation-label').fill('Greater trochanter');
    await page.getByTestId('annotation-description').fill('Bony **landmark**.\n\nAttachment for gluteal muscles.');
    await page.getByTestId('annotation-category').fill('Landmark');
    await page.getByTestId('annotation-link').fill('javascript:alert(1)');
    await expect(page.getByRole('alert').filter({ hasText: 'full web address' })).toBeVisible();
    await page.getByTestId('annotation-link').fill('https://example.org/femur');
    await expect(page.locator('.ann-edit__preview a')).toHaveAttribute('href', 'https://example.org/femur');
    await expect(page.locator('.ann-edit__preview a')).toHaveAttribute('rel', /noopener/);
    await expect(page.locator('.ann-edit__preview strong').first()).toContainText('Greater trochanter');
    // The marker is highlighted and listed
    await expect.poll(async () => (await debugState(page)).markers.filter((m) => m.selected).length).toBe(1);
    await expect(page.locator('.ann-item.is-selected')).toContainText('Greater trochanter');

    // Second annotation via the keyboard-friendly centre button
    await page.getByTestId('add-at-centre').click();
    await page.getByTestId('annotation-label').fill('Lesser trochanter');
    await expect(page.locator('.ann-item')).toHaveCount(2);

    await waitSaved(page);
    let m = await model(page, 'Femur test model');
    expect(m.annotations.map((a) => a.label)).toEqual(['Greater trochanter', 'Lesser trochanter']);
    expect(m.annotations[0].link?.url).toBe('https://example.org/femur');
    const before = m.annotations[0].anchor.position.slice();

    // Move the first annotation to another surface point
    await page.locator('.ann-item').first().click();
    await page.getByTestId('annotation-move').click();
    const p2 = await findSurfacePoint(page, 3);
    await page.mouse.click(p2.x, p2.y);
    await expect(page.getByTestId('mode-banner')).toBeHidden();
    await waitSaved(page);
    m = await model(page, 'Femur test model');
    expect(m.annotations[0].anchor.position).not.toEqual(before);
    expect(m.annotations[0].label).toBe('Greater trochanter');

    // Delete (with confirmation), undo, redo
    await page.locator('.ann-item').nth(1).click();
    await page.getByTestId('annotation-delete').click();
    await expect(page.getByRole('alertdialog')).toContainText('Delete annotation');
    await page.getByRole('button', { name: 'Delete annotation' }).click();
    await expect(page.locator('.ann-item')).toHaveCount(1);
    await page.getByTestId('undo').click();
    await expect(page.locator('.ann-item')).toHaveCount(2);
    await page.getByTestId('redo').click();
    await expect(page.locator('.ann-item')).toHaveCount(1);
    await page.getByTestId('undo').click();
    await expect(page.locator('.ann-item')).toHaveCount(2);
    // Undo the move too
    await page.getByTestId('undo').click();
    await waitSaved(page);
    m = await model(page, 'Femur test model');
    expect(m.annotations.map((a) => a.id)).toHaveLength(2);
  });

  test('4. saves a default view, regenerates the thumbnail and persists appearance', async () => {
    const beforeThumb = (await model(page, 'Femur test model')).thumbnailAssetId;
    // Change view: rotate with the buttons and zoom
    await page.getByRole('button', { name: 'Rotate left' }).click();
    await page.getByRole('button', { name: 'Rotate up' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByTestId('tab-appearance').click();
    await page.getByRole('button', { name: 'Slate' }).click();
    await page.getByLabel('Brightness').fill('1.4');
    await page.getByTestId('save-view').click();
    await expect(page.getByText(/Default view saved and thumbnail updated/)).toBeVisible({ timeout: 30_000 });
    await waitSaved(page);
    const m = await model(page, 'Femur test model');
    expect(m.view.camera).toBeTruthy();
    expect(m.thumbnailAssetId).not.toBe(beforeThumb);
    expect(m.view.lighting.exposure).toBeCloseTo(1.4, 2);
    const cam = (await debugState(page)).camera;
    expect(cam.position).toEqual(m.view.camera!.position);
    // Reset view returns to the saved view after moving away
    await page.getByRole('button', { name: 'Rotate right' }).click();
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect.poll(async () => (await debugState(page)).camera.position.map((v) => +v.toFixed(2))).toEqual(m.view.camera!.position.map((v) => +v.toFixed(2)));
  });

  test('5. everything persists across a reload', async () => {
    const before = await model(page, 'Femur test model');
    await page.reload(); // the hash route keeps the model workspace open
    await expect(page.locator('.ws-bar h1')).toHaveText('Femur test model');
    await expect(page.locator('.ws-stage .vp__controls')).toBeVisible({ timeout: 60_000 });
    const after = await model(page, 'Femur test model');
    expect(after).toEqual(before);
    await expect(page.locator('.ann-item')).toHaveCount(2);
    expect((await debugState(page)).camera.position.map((v) => +v.toFixed(3))).toEqual(after.view.camera!.position.map((v) => +v.toFixed(3)));
    await expect.poll(async () => Object.keys((await debugState(page)).markerStates).length).toBe(2);
    // Appearance persisted: the saved lighting is applied to the viewer
    await page.getByTestId('tab-appearance').click();
    await expect(page.getByLabel('Brightness')).toHaveValue('1.4');
    // The library and the thumbnail asset persisted too
    await page.getByRole('button', { name: 'Library' }).first().click();
    await expect(card(page, 'Femur test model')).toBeVisible();
    await expect(card(page, 'Knee model')).toBeVisible();
    await expect(card(page, 'Femur test model').locator('img')).toBeVisible();
    await expect.poll(() => card(page, 'Femur test model').locator('img').evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0))).toBeGreaterThan(100);
  });

  test('6. filters by region/system/search and selects models for export', async () => {
    await page.locator('label.filter-check', { hasText: 'Back and spine' }).locator('input').check();
    await expect(page.getByTestId('model-card')).toHaveCount(1);
    await expect(page.getByTestId('library-count')).toContainText('1 of 2');
    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await page.getByTestId('library-search').fill('knee');
    await expect(page.getByTestId('model-card')).toHaveCount(1);
    await page.getByTestId('library-search').fill('zzz');
    await expect(page.getByText('No models match your filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await card(page, 'Femur test model').getByTestId('select-model').check();
    await expect(page.getByTestId('go-export')).toContainText('1 selected');
    await page.locator('label.filter-check', { hasText: 'Only models selected' }).locator('input').check();
    await expect(page.getByTestId('model-card')).toHaveCount(1);
    await page.getByTestId('go-export').click();
    await expect(page.getByTestId('export-models').locator('li')).toHaveCount(1);
  });

  test('duplicates and deletes models with confirmation', async () => {
    await page.goto('/#/');
    await card(page, 'Knee model').getByTestId('card-menu').click();
    await page.getByTestId('card-duplicate').click();
    await expect(card(page, 'Knee model (copy)')).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0); // the previous menu must be gone before opening another
    await card(page, 'Knee model (copy)').getByTestId('card-menu').click();
    await page.getByTestId('card-delete').click();
    await expect(page.getByRole('alertdialog')).toContainText('cannot be undone');
    await page.getByRole('button', { name: 'Delete model' }).click();
    await expect(card(page, 'Knee model (copy)')).toHaveCount(0);
    // The original still opens (shared files were not removed with the copy)
    await openModel(page, 'Knee model');
  });
});
