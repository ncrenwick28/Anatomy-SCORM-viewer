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
    expect(restored).toEqual(m);
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
    await expect(parseBackup(badSchema)).rejects.toThrow(/invalid/);
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
