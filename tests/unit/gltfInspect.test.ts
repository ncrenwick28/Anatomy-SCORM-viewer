import { describe, expect, it } from 'vitest';
import {
  ModelFileError,
  assertSupported,
  matchCompanions,
  parseGltfText,
  readGlb,
  rewriteGltfUris,
  sanitiseFileName,
  summariseGltf,
} from '../../src/shared/gltfInspect';

function makeGlb(json: object, extra?: { magic?: number; version?: number; truncateBy?: number }): ArrayBuffer {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const total = 12 + 8 + jsonBytes.length;
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  v.setUint32(0, extra?.magic ?? 0x46546c67, true);
  v.setUint32(4, extra?.version ?? 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonBytes.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buf, 20).set(jsonBytes);
  return extra?.truncateBy ? buf.slice(0, total - extra.truncateBy) : buf;
}

const okJson = { asset: { version: '2.0' }, meshes: [{}], materials: [{}], nodes: [{}], scenes: [{}] };

describe('readGlb', () => {
  it('reads a valid GLB', () => {
    expect(readGlb(makeGlb(okJson)).asset.version).toBe('2.0');
  });
  it('explains an invalid header', () => {
    expect(() => readGlb(makeGlb(okJson, { magic: 0x12345678 }))).toThrow(/does not look like a GLB/);
  });
  it('rejects GLB v1', () => {
    expect(() => readGlb(makeGlb(okJson, { version: 1 }))).toThrow(/version 1/);
  });
  it('detects truncation', () => {
    expect(() => readGlb(makeGlb(okJson, { truncateBy: 8 }))).toThrow(/truncated/);
  });
  it('rejects tiny files', () => {
    expect(() => readGlb(new ArrayBuffer(4))).toThrow(ModelFileError);
  });
});

describe('parseGltfText', () => {
  it('rejects invalid JSON and non-2.0 versions', () => {
    expect(() => parseGltfText('{nope')).toThrow(/not valid JSON/);
    expect(() => parseGltfText('{"asset":{"version":"1.0"}}')).toThrow(/glTF 1.0/);
    expect(() => parseGltfText('{}')).toThrow(/asset.version/);
  });
  it('tolerates a BOM', () => {
    expect(parseGltfText('﻿' + JSON.stringify(okJson)).asset.version).toBe('2.0');
  });
});

describe('summariseGltf / assertSupported', () => {
  it('finds external dependencies and ignores data URIs', () => {
    const s = summariseGltf({ ...okJson, buffers: [{ uri: 'scene.bin' }, { uri: 'data:application/octet-stream;base64,AAAA' }], images: [{ uri: 'tex/skin%20a.png' }, { bufferView: 1 }] });
    expect(s.externalUris).toEqual(['scene.bin', 'tex/skin%20a.png']);
    expect(s.remoteUris).toEqual([]);
  });
  it('refuses remote URIs and KTX2-required models', () => {
    expect(() => assertSupported(summariseGltf({ ...okJson, images: [{ uri: 'https://cdn.example.org/a.png' }] }))).toThrow(/internet/);
    expect(() => assertSupported(summariseGltf({ ...okJson, extensionsRequired: ['KHR_texture_basisu'] }))).toThrow(/KTX2/);
    expect(() => assertSupported(summariseGltf({ ...okJson, extensionsRequired: ['KHR_draco_mesh_compression'] }))).not.toThrow();
    expect(() => assertSupported(summariseGltf({ asset: { version: '2.0' } }))).toThrow(/no 3D meshes/);
  });
});

describe('companion handling', () => {
  it('matches by path, then by file name, case-insensitively, and reports missing files', () => {
    const files = [{ name: 'SCENE.bin' }, { name: 'skin map.png', path: 'model/textures/skin map.png' }];
    const r = matchCompanions(['scene.bin', 'textures/Skin%20Map.PNG', 'missing.jpg'], files);
    expect(r.matched['scene.bin']).toBe(files[0]);
    expect(r.matched['textures/Skin%20Map.PNG']).toBe(files[1]);
    expect(r.missing).toEqual(['missing.jpg']);
    expect(r.ambiguous).toEqual([]);
  });
  it('tells same-named files apart by folder, and reports ambiguity instead of guessing', () => {
    const a = { name: 'diffuse.png', path: 'organ/textures/a/diffuse.png' };
    const b = { name: 'diffuse.png', path: 'organ/textures/b/diffuse.png' };
    const withFolders = matchCompanions(['textures/a/diffuse.png', 'textures/b/diffuse.png'], [b, a]);
    expect(withFolders.matched['textures/a/diffuse.png']).toBe(a);
    expect(withFolders.matched['textures/b/diffuse.png']).toBe(b);
    const noFolders = matchCompanions(['textures/a/diffuse.png'], [{ name: 'diffuse.png' }, { name: 'diffuse.png' }]);
    expect(noFolders.matched).toEqual({});
    expect(noFolders.ambiguous).toHaveLength(1);
    expect(noFolders.ambiguous[0].candidates).toHaveLength(2);
  });
  it('never lets one file stand in for two different references (review A-22)', () => {
    const only = { name: 'diffuse.png' };
    const one = matchCompanions(['textures/a/diffuse.png', 'textures/b/diffuse.png'], [only]);
    expect(one.matched).toEqual({}); // one loose file cannot be both textures
    expect(one.ambiguous.map((a) => a.uri).sort()).toEqual(['textures/a/diffuse.png', 'textures/b/diffuse.png']);
    const two = matchCompanions(['textures/a/diffuse.png', 'textures/b/diffuse.png'], [{ name: 'diffuse.png' }, { name: 'diffuse.png' }]);
    expect(two.matched).toEqual({});
    expect(two.ambiguous).toHaveLength(2);
    // a unique name is still matched by name alone
    const ok = matchCompanions(['textures/skin.png'], [{ name: 'skin.png' }]);
    expect(ok.matched['textures/skin.png']).toBeTruthy();
  });
  it('resolves references relative to each model\'s own folder when several models share a folder (review A-24)', () => {
    const files = [
      { name: 'diffuse.png', path: 'two/modelA/textures/diffuse.png' },
      { name: 'diffuse.png', path: 'two/modelB/textures/diffuse.png' },
    ];
    const a = matchCompanions(['textures/diffuse.png'], files, { baseDir: 'two/modelA' });
    const b = matchCompanions(['textures/diffuse.png'], files, { baseDir: 'two/modelB' });
    expect(a.matched['textures/diffuse.png']).toBe(files[0]);
    expect(b.matched['textures/diffuse.png']).toBe(files[1]);
    // a missing texture is not satisfied by a same-named file belonging to another model
    const missingOwn = matchCompanions(['textures/diffuse.png'], [files[1]], { baseDir: 'two/modelA' });
    expect(missingOwn.matched).toEqual({});
    // '..' segments resolve
    const up = matchCompanions(['../shared/skin.png'], [{ name: 'skin.png', path: 'two/shared/skin.png' }], { baseDir: 'two/modelA' });
    expect(up.matched['../shared/skin.png']).toBeTruthy();
  });
  it('sanitises and de-duplicates file names', () => {
    const taken = new Set<string>();
    expect(sanitiseFileName('Héart Model (final).GLB', taken)).toBe('Heart-Model-final.glb');
    expect(sanitiseFileName('Heart-Model-final.glb', taken)).toBe('Heart-Model-final-2.glb');
    expect(sanitiseFileName('../../etc/passwd', new Set())).toBe('passwd');
    expect(sanitiseFileName('???.png', new Set())).toBe('file.png');
  });
  it('rewrites URIs without mutating the input', () => {
    const src = { ...okJson, buffers: [{ uri: 'a b.bin' }], images: [{ uri: 'x/y.png' }] };
    const out = rewriteGltfUris(src, { 'a b.bin': 'a-b.bin', 'x/y.png': 'y.png' });
    expect(out.buffers[0].uri).toBe('a-b.bin');
    expect(out.images[0].uri).toBe('y.png');
    expect(src.buffers[0].uri).toBe('a b.bin');
  });
});
