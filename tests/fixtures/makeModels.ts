import { Document, WebIO } from '@gltf-transform/core';
import { deflateSync } from 'node:zlib';
import type { ModelRecord } from '../../src/shared/types';
import { defaultViewSettings } from '../../src/shared/types';

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A valid solid-colour PNG, built without any image library. */
export function makePng(w = 4, h = 4, rgb: [number, number, number] = [200, 80, 60]): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

function buildDoc(opts: { meshes: number; texture?: boolean }): Document {
  const doc = new Document();
  const buffer = doc.createBuffer('main');
  const scene = doc.createScene('scene');
  const mat = doc.createMaterial('skin').setBaseColorFactor([0.8, 0.4, 0.3, 1]);
  if (opts.texture) {
    const tex = doc.createTexture('skin-tex').setImage(makePng()).setMimeType('image/png').setURI('skin texture.png');
    mat.setBaseColorTexture(tex);
  }
  for (let i = 0; i < opts.meshes; i++) {
    const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0 + i, 0, 0, 1 + i, 0, 0, 0 + i, 1, 0, 1 + i, 1, 0.5])).setBuffer(buffer);
    const uv = doc.createAccessor().setType('VEC2').setArray(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])).setBuffer(buffer);
    const idx = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 2, 1, 3])).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('TEXCOORD_0', uv).setIndices(idx).setMaterial(mat);
    const mesh = doc.createMesh(`Part ${i + 1}`).addPrimitive(prim);
    const node = doc.createNode(`Part ${i + 1}`).setMesh(mesh);
    scene.addChild(node);
  }
  return doc;
}

export async function makeGlbBytes(meshes = 2): Promise<Uint8Array> {
  return new WebIO().writeBinary(buildDoc({ meshes }));
}

export async function makeGltfFiles(meshes = 2): Promise<{ gltf: Uint8Array; resources: Record<string, Uint8Array>; jsonName: string }> {
  const { json, resources } = await new WebIO().writeJSON(buildDoc({ meshes, texture: true }), { basename: 'knee model' });
  return { gltf: new TextEncoder().encode(JSON.stringify(json)), resources, jsonName: 'knee model.gltf' };
}

export function fileOf(bytes: Uint8Array | string, name: string, type = ''): File {
  return new File([bytes as BlobPart], name, { type });
}

export function sampleModel(overrides: Partial<ModelRecord> = {}): ModelRecord {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'model-1',
    title: 'Sample model',
    description: 'A **sample** description.',
    credit: '',
    isDemo: false,
    regionIds: ['region-thorax'],
    systemIds: ['system-cardiovascular', 'system-respiratory'],
    format: 'glb',
    entryName: 'sample.glb',
    assets: [{ id: 'asset-1', name: 'sample.glb', size: 5, mime: 'model/gltf-binary' }],
    thumbnailAssetId: 'asset-thumb-1',
    stats: { totalBytes: 5, triangles: 2, vertices: 4, meshCount: 2, materialCount: 1, textureCount: 0, boundsSize: [1, 1, 1], extensionsUsed: [] },
    view: defaultViewSettings(),
    annotations: [
      {
        id: 'ann-1',
        label: 'Apex',
        description: 'Point of **interest**.',
        category: 'Landmark',
        link: { url: 'https://example.org/apex', title: 'More' },
        required: true,
        anchor: { meshKey: '0', meshName: 'Part 1', position: [0.5, 0.5, 0], normal: [0, 0, 1] },
        createdAt: now,
        updatedAt: now,
      },
    ],
    meshLabels: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** A Draco-compressed GLB (UV sphere), to exercise the decoder path in the app and in exported packages. */
export async function makeDracoGlb(): Promise<Uint8Array> {
  const [{ default: draco3d }, { KHRDracoMeshCompression }] = await Promise.all([import('draco3dgltf'), import('@gltf-transform/extensions')]);
  const doc = new Document();
  const buffer = doc.createBuffer('main');
  const scene = doc.createScene('scene');
  const seg = 24;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let y = 0; y <= seg; y++) {
    for (let x = 0; x <= seg; x++) {
      const u = (x / seg) * Math.PI * 2;
      const v = (y / seg) * Math.PI;
      pos.push(Math.cos(u) * Math.sin(v) * 2, Math.cos(v) * 2, Math.sin(u) * Math.sin(v) * 2);
    }
  }
  for (let y = 0; y < seg; y++) for (let x = 0; x < seg; x++) {
    const a = y * (seg + 1) + x;
    const b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const accP = doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer);
  const accI = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer);
  const mat = doc.createMaterial('bone').setBaseColorFactor([0.9, 0.85, 0.7, 1]);
  const prim = doc.createPrimitive().setAttribute('POSITION', accP).setIndices(accI).setMaterial(mat);
  scene.addChild(doc.createNode('Sphere').setMesh(doc.createMesh('Sphere').addPrimitive(prim)));
  doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER });
  const io = new WebIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({ 'draco3d.encoder': await draco3d.createEncoderModule() });
  return io.writeBinary(doc);
}
