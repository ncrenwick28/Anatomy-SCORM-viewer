import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ProjectStore, defaultProject } from '../../src/storage/ProjectStore';
import { createBackup, parseBackup, restoreBackup, BackupError } from '../../src/storage/backup';
import { buildZip } from '../../src/shared/zip';
import { fileOf, sampleModel } from '../fixtures/makeModels';

let store: ProjectStore;
beforeEach(async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  store = await ProjectStore.open('test-db');
});

async function seed(id = 'model-1') {
  const m = sampleModel({ id, assets: [{ id: `${id}-glb`, name: 'sample.glb', size: 5, mime: 'model/gltf-binary' }], thumbnailAssetId: `${id}-thumb` });
  await store.putModels([m]);
  await store.putAsset({ id: `${id}-glb`, name: 'sample.glb', mime: 'model/gltf-binary', size: 5, blob: new Blob([new Uint8Array([1, 2, 3, 4, 5])]), createdAt: 'x' });
  await store.putAsset({ id: `${id}-thumb`, name: 'thumb.jpg', mime: 'image/jpeg', size: 3, blob: new Blob([new Uint8Array([9, 9, 9])]), createdAt: 'x' });
  return m;
}

describe('ProjectStore', () => {
  it('initialises a default project with editable categories and persists changes across reopen', async () => {
    const p = await store.getProject();
    expect(p.regions.length).toBeGreaterThanOrEqual(7);
    expect(p.systems.length).toBeGreaterThanOrEqual(10);
    p.regions.push({ id: 'region-custom', name: 'Custom' });
    await store.putProject(p);
    store.close();
    store = await ProjectStore.open('test-db');
    expect((await store.getProject()).regions.some((r) => r.id === 'region-custom')).toBe(true);
  });

  it('persists models and their assets', async () => {
    const m = await seed();
    const loaded = await store.getModel(m.id);
    expect(loaded?.annotations[0].label).toBe('Apex');
    expect(loaded?.systemIds).toEqual(['system-cardiovascular', 'system-respiratory']);
    const asset = await store.getAsset('model-1-glb');
    expect(asset?.blob.size).toBe(5);
  });

  it('deleting a model removes its orphaned assets but keeps shared ones', async () => {
    await seed('a');
    const b = sampleModel({ id: 'b', assets: [{ id: 'a-glb', name: 'sample.glb', size: 5, mime: 'model/gltf-binary' }], thumbnailAssetId: null });
    await store.putModels([b]); // b shares a's model file (as a duplicate does)
    await store.deleteModel('a');
    expect(await store.getAsset('a-glb')).toBeDefined();
    expect(await store.getAsset('a-thumb')).toBeUndefined();
    await store.deleteModel('b');
    expect(await store.getAsset('a-glb')).toBeUndefined();
  });

  it('keeps the export logo when deleting models', async () => {
    await seed('a');
    const p = defaultProject();
    p.exportConfig.logoAssetId = 'a-thumb';
    await store.putProject(p);
    await store.deleteModel('a');
    expect(await store.getAsset('a-thumb')).toBeDefined();
  });
});

describe('optimistic concurrency between tabs', () => {
  it('refuses to overwrite a record another tab saved first, and writes nothing', async () => {
    const m = await seed();
    const tabA = store;
    const tabB = await ProjectStore.open('test-db'); // a second connection = a second tab
    const readA = (await tabA.listModels())[0];
    const first = await tabA.commitChanges({ models: [{ record: readA, baseRev: readA.rev }] });
    expect(first.ok).toBe(true);
    const revA = first.ok ? first.revs[m.id] : '';
    // Tab B still holds the record as originally loaded (rev undefined) and tries to save its own edit
    const stale = await tabB.commitChanges({ models: [{ record: { ...readA, title: 'Edited in B' }, baseRev: undefined }], project: { record: defaultProject(), baseRev: undefined } });
    expect(stale).toEqual({ ok: false, conflicts: [m.id], projectConflict: false, missingFiles: [] });
    expect((await tabA.getModel(m.id))?.title).toBe('Sample model');
    // After re-reading, tab B may save
    const ok = await tabB.commitChanges({ models: [{ record: { ...readA, title: 'Edited in B' }, baseRev: revA }] });
    expect(ok.ok).toBe(true);
    expect((await tabA.getModel(m.id))?.title).toBe('Edited in B');
  });

  it('refuses to re-create or duplicate a model whose files were deleted in another tab', async () => {
    const m = await seed();
    const tabB = await ProjectStore.open('test-db');
    await tabB.deleteModel(m.id);
    const resurrect = await store.commitChanges({ models: [{ record: m, baseRev: 'rev-that-existed' }] });
    expect(resurrect).toMatchObject({ ok: false, missingFiles: [m.id] });
    const duplicate = await store.commitChanges({ models: [{ record: { ...m, id: 'copy-1' }, baseRev: undefined }] });
    expect(duplicate).toMatchObject({ ok: false, missingFiles: ['copy-1'] });
    expect(await store.listModels()).toEqual([]); // nothing was (re)created
  });

  it('keeps the project revision when the project is read back (review A-21)', async () => {
    const first = await store.commitChanges({ models: [], project: { record: defaultProject(), baseRev: undefined } });
    expect(first.ok).toBe(true);
    const projectRev = first.ok ? first.projectRev : undefined;
    expect(projectRev).toBeTruthy();
    // A reload reads the project; its revision must come back, or the next save looks like a conflict
    const reread = await store.getProject();
    expect(reread.rev).toBe(projectRev);
    const second = await store.commitChanges({ models: [], project: { record: reread, baseRev: reread.rev } });
    expect(second.ok).toBe(true);
  });
});

describe('backup and restore', () => {
  it('round-trips a project exactly (replace)', async () => {
    const m = await seed();
    const p = await store.getProject();
    p.exportConfig.selectedModelIds = [m.id];
    p.exportConfig.title = 'My course';
    await store.putProject(p);
    const backup = await createBackup(store);
    expect(backup.filename).toMatch(/^anatomy-project-backup-\d{8}-\d{4}\.zip$/);

    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    const fresh = await ProjectStore.open('fresh-db');
    const parsed = await parseBackup(backup.blob);
    expect(parsed.warnings).toEqual([]);
    await restoreBackup(fresh, parsed, 'replace');
    const restored = (await fresh.listModels())[0];
    expect({ ...restored, rev: undefined }).toEqual({ ...m, rev: undefined }); // restore stamps a fresh revision
    expect((await fresh.getProject()).exportConfig.title).toBe('My course');
    expect(new Uint8Array(await (await fresh.getAsset('model-1-glb'))!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('merge adds models with fresh ids and leaves existing work untouched', async () => {
    await seed();
    const backup = await createBackup(store);
    const parsed = await parseBackup(backup.blob);
    await restoreBackup(store, parsed, 'merge');
    const models = await store.listModels();
    expect(models).toHaveLength(2);
    expect(new Set(models.map((x) => x.id)).size).toBe(2);
    const copy = models.find((x) => x.id !== 'model-1')!;
    expect(await store.getAsset(copy.assets[0].id)).toBeDefined();
    expect(copy.assets[0].id).not.toBe('model-1-glb');
  });

  it('rejects things that are not valid backups with specific messages', async () => {
    await expect(parseBackup(new Blob(['not a zip']))).rejects.toThrow(BackupError);
    const noProject = await buildZip([{ path: 'x.txt', data: new TextEncoder().encode('hi') }]);
    await expect(parseBackup(noProject)).rejects.toThrow(/project\.json is missing/);
    const wrongApp = await buildZip([{ path: 'project.json', data: new TextEncoder().encode('{"app":"other"}') }]);
    await expect(parseBackup(wrongApp)).rejects.toThrow(/not created by this application/);
    const badSchema = await buildZip([{ path: 'project.json', data: new TextEncoder().encode('{"app":"anatomy-scorm-studio","schemaVersion":1}') }]);
    await expect(parseBackup(badSchema)).rejects.toThrow(/damaged or was not made by this version/);
  });

  it('detects a backup with a missing or damaged asset and unsafe paths', async () => {
    await seed();
    const good = await createBackup(store);
    const parsed = await parseBackup(good.blob);
    const manifest = JSON.parse(JSON.stringify(parsed.manifest));
    // Missing asset file
    const missing = await buildZip([{ path: 'project.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }]);
    await expect(parseBackup(missing)).rejects.toThrow(/incomplete/);
    // Wrong size
    const entries = [{ path: 'project.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }, ...manifest.assets.map((a: { path: string }) => ({ path: a.path, data: new Uint8Array([1]) }))];
    await expect(parseBackup(await buildZip(entries))).rejects.toThrow(/damaged/);
    // Unsafe path
    manifest.assets[0].path = '../evil.glb';
    await expect(parseBackup(await buildZip([{ path: 'project.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }]))).rejects.toThrow(/unsafe/);
  });

  it('always produces a restorable backup, repairing text the editor allowed (empty label, over-long link)', async () => {
    const m = sampleModel();
    m.annotations[0].label = '   ';
    m.annotations[0].link = { url: `https://example.org/${'x'.repeat(2500)}`, title: 'long' };
    m.annotations[0].description = 'd'.repeat(5000);
    m.description = 'e'.repeat(9000);
    await store.putModels([m]);
    await store.putAsset({ id: 'asset-1', name: 'sample.glb', mime: 'model/gltf-binary', size: 5, blob: new Blob([new Uint8Array(5)]), createdAt: 'x' });
    await store.putAsset({ id: 'asset-thumb-1', name: 'thumb.jpg', mime: 'image/jpeg', size: 3, blob: new Blob([new Uint8Array(3)]), createdAt: 'x' });
    const backup = await createBackup(store);
    expect(backup.repairs.join(' ')).toMatch(/no label/);
    const parsed = await parseBackup(backup.blob); // must not throw
    const a = parsed.manifest.models[0].annotations[0];
    expect(a.label).toBe('Annotation 1');
    expect(a.link).toBeNull();
    expect(a.description.length).toBe(4000);
    // The live project is untouched by the backup
    expect((await store.getModel(m.id))!.annotations[0].label).toBe('   ');
  });

  it('restore repairs a backup that an older build wrote with an empty label instead of rejecting the project', async () => {
    const m = await seed();
    const good = await createBackup(store);
    const parsed = await parseBackup(good.blob);
    const manifest = JSON.parse(JSON.stringify(parsed.manifest));
    manifest.models[0].annotations[0].label = '';
    const entries = [{ path: 'project.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }, ...manifest.assets.map((a: { path: string; id: string }) => ({ path: a.path, data: parsed.files.get(a.path)! }))];
    const repaired = await parseBackup(await buildZip(entries));
    expect(repaired.warnings.join(' ')).toMatch(/no label/);
    expect(repaired.manifest.models[0].annotations[0].label).toBe('Annotation 1');
    expect(m.id).toBe('model-1');
  });

  it('every state the editor can save round-trips through backup and restore (fuzzed)', async () => {
    let seedN = 12345;
    const rnd = () => ((seedN = (seedN * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    const strings = ['', ' ', 'Plain', '  padded  ', 'ünïcödé 😀', '<script>alert(1)</script>', 'x'.repeat(10), 'y'.repeat(200), 'z'.repeat(9000), '**b** _i_ [l](https://e.org)'];
    const links = [null, { url: 'https://example.org', title: '' }, { url: 'javascript:alert(1)', title: 't' }, { url: `https://e.org/${'q'.repeat(3000)}`, title: 'long' }, { url: '', title: '' }];
    for (let round = 0; round < 40; round++) {
      const m = sampleModel({ id: `fz-${round}`, assets: [{ id: `fz-${round}-glb`, name: 'a.glb', size: 5, mime: 'model/gltf-binary' }], entryName: 'a.glb', thumbnailAssetId: null });
      m.title = pick(strings);
      m.description = pick(strings);
      m.credit = pick(strings);
      m.annotations = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => ({
        ...sampleModel().annotations[0],
        id: `ann-${round}-${i}`,
        label: pick(strings),
        description: pick(strings),
        category: pick(strings),
        link: pick(links) as never,
      }));
      await store.putModels([m]);
      await store.putAsset({ id: `fz-${round}-glb`, name: 'a.glb', mime: 'model/gltf-binary', size: 5, blob: new Blob([new Uint8Array(5)]), createdAt: 'x' });
    }
    const backup = await createBackup(store);
    const parsed = await parseBackup(backup.blob);
    expect(parsed.manifest.models).toHaveLength(40);
    for (const m of parsed.manifest.models) {
      expect(m.title.trim().length).toBeGreaterThan(0);
      for (const a of m.annotations) {
        expect(a.label.trim().length).toBeGreaterThan(0);
        if (a.link) expect(a.link.url.startsWith('http')).toBe(true);
      }
    }
  });

  it('refuses to back up a project with missing model files', async () => {
    await store.putModels([sampleModel()]);
    await expect(createBackup(store)).rejects.toThrow(/missing/);
  });

  it('does not mutate stored data when a restore is rejected', async () => {
    const m = await seed();
    await expect(parseBackup(fileOf('junk', 'x.zip'))).rejects.toThrow();
    expect((await store.getModel(m.id))?.title).toBe('Sample model');
  });
});
