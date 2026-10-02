import { describe, expect, it } from 'vitest';
import { planImports, prepareAssets, humaniseFileName } from '../../src/storage/importer';
import { LIMITS } from '../../src/shared/types';
import { fileOf, makeGlbBytes, makeGltfFiles } from '../fixtures/makeModels';

describe('importer', () => {
  it('accepts a valid GLB and humanises its title', async () => {
    const plan = await planImports([{ file: fileOf(await makeGlbBytes(), 'left-ventricle_v2.glb') }]);
    expect(plan.candidates).toHaveLength(1);
    const c = plan.candidates[0];
    expect(c.errors).toEqual([]);
    expect(c.title).toBe('Left ventricle v2');
    expect(c.summary?.meshCount).toBe(2);
    const prepared = await prepareAssets(c);
    expect(prepared.entryName).toBe('left-ventricle_v2.glb');
    expect(prepared.assets).toHaveLength(1);
    expect(prepared.assets[0].ref.mime).toBe('model/gltf-binary');
  });

  it('reports a truncated GLB, a non-GLB renamed .glb and an empty file', async () => {
    const bytes = await makeGlbBytes();
    const plan = await planImports([
      { file: fileOf(bytes.slice(0, bytes.length - 10), 'cut.glb') },
      { file: fileOf('hello world, definitely not a model', 'fake.glb') },
      { file: fileOf(new Uint8Array(0), 'empty.glb') },
    ]);
    expect(plan.candidates.map((c) => c.errors.length > 0)).toEqual([true, true, true]);
    expect(plan.candidates[0].errors[0]).toMatch(/truncated/);
    expect(plan.candidates[1].errors[0]).toMatch(/does not look like a GLB/);
    expect(plan.candidates[2].errors[0]).toMatch(/empty/);
  });

  it('explains unsupported formats instead of importing them', async () => {
    const plan = await planImports([{ file: fileOf('v 0 0 0', 'heart.obj') }, { file: fileOf('x', 'model.fbx') }, { file: fileOf('x', 'notes.txt') }]);
    expect(plan.candidates).toHaveLength(0);
    expect(plan.ignored[0].reason).toMatch(/OBJ.*Convert/);
    expect(plan.ignored[1].reason).toMatch(/FBX/);
    expect(plan.ignored[2].reason).toMatch(/not used/);
  });

  it('reports missing companion files for .gltf and resolves them once supplied', async () => {
    const { gltf, resources, jsonName } = await makeGltfFiles();
    const names = Object.keys(resources);
    expect(names.length).toBeGreaterThanOrEqual(2);
    const alone = await planImports([{ file: fileOf(gltf, jsonName) }]);
    expect(alone.candidates[0].missing.sort()).toEqual(names.sort());
    expect(alone.candidates[0].errors[0]).toMatch(/Missing 2 companion files/);

    const full = await planImports([{ file: fileOf(gltf, jsonName) }, ...names.map((n) => ({ file: fileOf(resources[n], n) }))]);
    const c = full.candidates[0];
    expect(c.errors).toEqual([]);
    expect(c.companions).toHaveLength(names.length);
    const prepared = await prepareAssets(c);
    // Names are flat and safe, and the .gltf now points at them.
    expect(prepared.assets.every((a) => /^[A-Za-z0-9._-]+$/.test(a.ref.name))).toBe(true);
    const json = JSON.parse(await prepared.assets[0].blob.text());
    const uris = [...json.buffers.map((b: { uri: string }) => b.uri), ...json.images.map((i: { uri: string }) => i.uri)];
    for (const uri of uris) expect(prepared.assets.some((a) => a.ref.name === uri)).toBe(true);
    expect(prepared.entryName).toBe('knee-model.gltf');
  });

  it('flags unreferenced companion files as ignored', async () => {
    const { gltf, resources, jsonName } = await makeGltfFiles();
    const plan = await planImports([{ file: fileOf(gltf, jsonName) }, ...Object.keys(resources).map((n) => ({ file: fileOf(resources[n], n) })), { file: fileOf(new Uint8Array(4), 'stray.png') }]);
    expect(plan.ignored.some((i) => i.name === 'stray.png')).toBe(true);
  });

  it('warns about large models and refuses ones above the hard limit', async () => {
    const glb = await makeGlbBytes();
    const big = new File([glb as BlobPart, new Uint8Array(LIMITS.modelWarnBytes + 1024) as BlobPart], 'big.glb'); // valid GLB with trailing bytes
    const warn = (await planImports([{ file: big }])).candidates[0];
    expect(warn.errors).toEqual([]);
    expect(warn.warnings.join(' ')).toMatch(/Large model/);
    const huge = fileOf(glb, 'huge.glb');
    Object.defineProperty(huge, 'size', { value: LIMITS.modelMaxBytes + 1 });
    const refuse = (await planImports([{ file: huge }])).candidates[0];
    expect(refuse.errors.join(' ')).toMatch(/above the 300 MB limit/);
  });

  it('humanises file names', () => {
    expect(humaniseFileName('knee-joint.glb')).toBe('Knee joint');
    expect(humaniseFileName('.glb')).toBe('Untitled model');
  });
});
