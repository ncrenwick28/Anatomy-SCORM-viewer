import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildScormPackage, type AssetData } from '../../src/export/buildPackage';
import { generateManifest12, xmlEscape } from '../../src/export/manifest';
import { runPreflight } from '../../src/export/preflight';
import { generateLaunchPage } from '../../src/export/launchPage';
import { readZip } from '../../src/shared/zip';
import { DEFAULT_REGIONS, DEFAULT_SYSTEMS, defaultExportConfig, type ModelRecord } from '../../src/shared/types';
import { sampleModel } from '../fixtures/makeModels';

const enc = new TextEncoder();
function mk(id: string, title: string, extra: Partial<ModelRecord> = {}): ModelRecord {
  return sampleModel({
    id,
    title,
    entryName: `${id}.glb`,
    assets: [{ id: `${id}-glb`, name: `${id}.glb`, size: 4, mime: 'model/gltf-binary' }],
    thumbnailAssetId: `${id}-thumb`,
    ...extra,
  });
}
const store: Record<string, AssetData> = {};
for (const id of ['a', 'b', 'c']) {
  store[`${id}-glb`] = { name: `${id}.glb`, blob: new Uint8Array([1, 2, 3, 4]), mime: 'model/gltf-binary' };
  store[`${id}-thumb`] = { name: 'thumb.jpg', blob: new Uint8Array([0xff, 0xd8, 9]), mime: 'image/jpeg' };
}
store['logo'] = { name: 'my logo.png', blob: new Uint8Array([1, 2, 3]), mime: 'image/png' };
const player = { js: enc.encode('/*player*/'), css: enc.encode('/*css*/') };
const readAsset = async (id: string) => store[id];

async function build(selected: ModelRecord[], cfg = {}) {
  const config = { ...defaultExportConfig(), title: 'Thorax & "heart" <demo>', logoAssetId: 'logo', selectedModelIds: selected.map((m) => m.id), ...cfg };
  const built = await buildScormPackage({ config, regions: DEFAULT_REGIONS, systems: DEFAULT_SYSTEMS, models: selected, readAsset, player });
  const files = await readZip(built.blob, { maxTotalBytes: 1e9, maxEntries: 1000 });
  return { built, files };
}

describe('SCORM 1.2 package builder', () => {
  it('contains the manifest at the root and every referenced file, with relative paths only', async () => {
    const { built, files } = await build([mk('a', 'Heart'), mk('b', 'Lungs')]);
    expect(files.has('imsmanifest.xml')).toBe(true);
    expect(files.has('index.html')).toBe(true);
    expect(files.has('data/content.js')).toBe(true);
    expect(files.has('assets/player.js')).toBe(true);
    const xml = new TextDecoder().decode(files.get('imsmanifest.xml')!);
    const hrefs = [...xml.matchAll(/<file href="([^"]+)"/g)].map((m) => m[1]);
    for (const h of hrefs) {
      expect(files.has(h), `listed file missing from zip: ${h}`).toBe(true);
      expect(h.startsWith('/') || h.includes('..') || /^[a-z]+:/i.test(h)).toBe(false);
    }
    // Everything except the manifest is listed in the manifest (and nothing else).
    expect(new Set(hrefs)).toEqual(new Set([...files.keys()].filter((k) => k !== 'imsmanifest.xml')));
    expect(xml).toContain('<schemaversion>1.2</schemaversion>');
    expect(xml).toContain('adlcp:scormtype="sco"');
    expect(xml).toContain('href="index.html"');
    expect(built.bytes).toBe(built.blob.size);
  });

  it('produces a well-formed manifest even with hostile characters in the title', async () => {
    const { files } = await build([mk('a', 'Heart')]);
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
    const path = join(dir, 'imsmanifest.xml');
    writeFileSync(path, files.get('imsmanifest.xml')!);
    const r = spawnSync('xmllint', ['--noout', path], { encoding: 'utf8' });
    if (r.error) return; // xmllint not installed: structural assertions above still apply
    expect(r.status, r.stderr).toBe(0);
    expect(new TextDecoder().decode(files.get('imsmanifest.xml')!)).toContain('Thorax &amp; &quot;heart&quot; &lt;demo&gt;');
  });

  it('includes only the selected models and their assets', async () => {
    const { files, built } = await build([mk('b', 'Lungs')]);
    const paths = [...files.keys()];
    expect(paths.filter((p) => p.startsWith('models/')).length).toBe(1);
    expect(paths.some((p) => p.includes('/a.glb') || p.includes('/c.glb'))).toBe(false);
    expect(built.content.models.map((m) => m.id)).toEqual(['b']);
  });

  it('writes content.js that parses back to the same content, with relative asset paths', async () => {
    const m = mk('a', 'Heart');
    const { files, built } = await build([m]);
    const js = new TextDecoder().decode(files.get('data/content.js')!);
    expect(js.startsWith('window.__ANATOMY_CONTENT__=')).toBe(true);
    const content = JSON.parse(js.slice('window.__ANATOMY_CONTENT__='.length).replace(/;\n$/, ''));
    expect(content).toEqual(JSON.parse(JSON.stringify(built.content)));
    const pm = content.models[0];
    expect(files.has(pm.entry)).toBe(true);
    expect(files.has(pm.thumbnail)).toBe(true);
    expect(pm.annotations).toEqual(JSON.parse(JSON.stringify(m.annotations)));
    expect(pm.view).toEqual(JSON.parse(JSON.stringify(m.view)));
    expect(content.logo).toBe('branding/logo.png');
    // Categories are trimmed to those in use.
    expect(content.regions.map((r: { id: string }) => r.id)).toEqual(['region-thorax']);
  });

  it('is reproducible and its content hash changes with annotations', async () => {
    const a1 = await build([mk('a', 'Heart')]);
    const a2 = await build([mk('a', 'Heart')]);
    expect(a1.built.content.contentHash).toBe(a2.built.content.contentHash);
    const changed = mk('a', 'Heart');
    changed.annotations = [...changed.annotations, { ...changed.annotations[0], id: 'ann-2' }];
    expect((await build([changed])).built.content.contentHash).not.toBe(a1.built.content.contentHash);
  });

  it('refuses to build when files are missing, corrupt or no models are chosen', async () => {
    const m = mk('a', 'Heart');
    const input = { config: defaultExportConfig(), regions: [], systems: [], player };
    await expect(buildScormPackage({ ...input, models: [], readAsset })).rejects.toThrow(/at least one model/);
    await expect(buildScormPackage({ ...input, models: [m], readAsset: async (id) => (id === 'a-glb' ? undefined : store[id]) })).rejects.toThrow(/missing/);
    await expect(buildScormPackage({ ...input, models: [m], readAsset: async (id) => (id === 'a-glb' ? { ...store[id], blob: new Uint8Array(9) } : store[id]) })).rejects.toThrow(/corrupted/);
    await expect(buildScormPackage({ ...input, models: [{ ...m, thumbnailAssetId: null }], readAsset })).rejects.toThrow(/no thumbnail/);
  });

  it('launch page is CSP-confined and references only relative files', () => {
    const html = generateLaunchPage('A <b>title</b>');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('&lt;b&gt;title&lt;/b&gt;');
    expect(html).toContain('lang="en-GB"');
  });

  it('manifest escaping and structure', () => {
    expect(xmlEscape(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
    const xml = generateManifest12({ identifier: 'a b/c', title: 'x'.repeat(300), files: ['index.html', 'a&b.txt'], launch: 'index.html' });
    expect(xml).toMatch(/identifier="PKG-a-b-c"/);
    expect(xml).toContain('a&amp;b.txt');
    expect(xml.match(/<title>x{100}<\/title>/g)).toHaveLength(2);
  });
});

describe('preflight', () => {
  const base = () => ({
    config: { ...defaultExportConfig(), title: 'Course', selectedModelIds: ['a'] },
    models: [mk('a', 'Heart')],
    regions: DEFAULT_REGIONS,
    systems: DEFAULT_SYSTEMS,
    storedAssetIds: new Set(['a-glb', 'a-thumb']),
  });
  const withCamera = (m: ModelRecord): ModelRecord => ({ ...m, view: { ...m.view, camera: { position: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0], quaternion: [0, 0, 0, 1], zoom: 1, fov: 40, aspect: 1.3 } } });

  it('passes a healthy selection', () => {
    const inp = base();
    inp.models = [withCamera(inp.models[0])];
    const r = runPreflight(inp);
    expect(r.ok).toBe(true);
    expect(r.errors).toBe(0);
  });
  it('blocks export when nothing is selected, files are missing, or links are invalid', () => {
    const empty = runPreflight({ ...base(), models: [] });
    expect(empty.issues.some((i) => i.code === 'no-models')).toBe(true);
    const missing = runPreflight({ ...base(), storedAssetIds: new Set() });
    expect(missing.issues.some((i) => i.code === 'missing-file')).toBe(true);
    expect(missing.ok).toBe(false);
    const inp = base();
    inp.models[0].annotations[0].link = { url: 'javascript:alert(1)', title: 'x' };
    expect(runPreflight(inp).issues.some((i) => i.code === 'annotation-bad-link')).toBe(true);
  });
  it('warns, without blocking, about missing descriptions, default views and categories', () => {
    const inp = base();
    inp.models[0] = { ...inp.models[0], description: '', regionIds: [], systemIds: [] };
    const r = runPreflight(inp);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['no-description', 'uncategorised', 'no-default-view']));
    expect(r.ok).toBe(true);
  });
  it('reports annotation anchors that failed the deep check as errors', () => {
    const r = runPreflight({ ...base(), anchorProblems: { a: [{ annotationId: 'ann-1', label: 'Apex', reason: 'its structure was not found in the model.' }] } });
    expect(r.ok).toBe(false);
    expect(r.issues.find((i) => i.code === 'anchor-problem')?.message).toContain('Apex');
  });
  it('rejects self-study without the annotation list', () => {
    const inp = base();
    inp.config.features = { ...inp.config.features, annotationList: false, selfStudy: true };
    expect(runPreflight(inp).issues.some((i) => i.code === 'selfstudy-needs-list')).toBe(true);
  });
  it('warns when the annotation rule has no required annotations', () => {
    const inp = base();
    inp.config.completion = 'open-all-and-annotations';
    inp.models[0].annotations = [];
    expect(runPreflight(inp).issues.some((i) => i.code === 'no-required-annotations')).toBe(true);
  });
});
