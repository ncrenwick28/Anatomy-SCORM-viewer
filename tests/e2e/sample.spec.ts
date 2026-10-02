import { expect, test } from '@playwright/test';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZip } from '../../src/shared/zip';
import { buildViaUi, gotoApp, loadDemo, waitSaved } from './helpers';

// Regenerates sample/anatomy-demo-package-scorm12.zip through the real UI. Run with: npm run sample:export
test.skip(!process.env.WRITE_SAMPLE, 'only runs for `npm run sample:export`');

test('builds the sample package from the four demonstration models', async ({ page }) => {
  await gotoApp(page);
  await loadDemo(page);
  await page.getByRole('button', { name: 'Select all shown' }).click();
  await page.getByTestId('go-export').click();
  await page.getByTestId('export-title').fill('Anatomy 3D: demonstration package');
  await page.getByLabel(/Short description/).fill('Four schematic demonstration models showing the student experience: gallery, 3D viewer, annotations and self-study mode.');
  await page.getByTestId('export-intro').fill('This is a **demonstration package** built with Anatomy SCORM Studio.\n\n- Open each model and rotate, zoom and pan it.\n- Select the numbered markers, or use the annotation list.\n- Try **self-study mode** to hide the names and test yourself.\n\nThe models are simplified schematic shapes (CC0) and are *not* anatomically accurate.');
  await page.getByTestId('completion-open-all-and-annotations').check();
  await waitSaved(page);
  const zip = await buildViaUi(page, 'sample-package.zip');
  const files = await readZip(new Blob([readFileSync(zip)]), { maxTotalBytes: 1e9, maxEntries: 1000 });
  expect([...files.keys()].filter((k) => k.endsWith('.glb'))).toHaveLength(4);
  mkdirSync('sample', { recursive: true });
  copyFileSync(zip, join('sample', 'anatomy-demo-package-scorm12.zip'));
});
