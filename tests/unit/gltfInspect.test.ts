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
    const r = matchCompanions(['scene.bin', 'textures/Skin%20Map.PNG', 'missing.jpg'], [
      { name: 'SCENE.bin' },
      { name: 'skin map.png', path: 'model/textures/skin map.png' },
    ]);
    expect(r.matched).toEqual({ 'scene.bin': 'SCENE.bin', 'textures/Skin%20Map.PNG': 'skin map.png' });
    expect(r.missing).toEqual(['missing.jpg']);
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
