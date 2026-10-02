import { describe, expect, it } from 'vitest';
import { computeCompletion, emptyProgress, markOpened, markViewed } from '../../src/shared/completion';
import { decodeProgress, encodeProgress } from '../../src/shared/progressCodec';
import { LMS_SUSPEND_DATA_LIMIT } from '../../src/shared/types';

const models = [
  { id: 'm1', requiredAnnotationIds: ['a1', 'a2'] },
  { id: 'm2', requiredAnnotationIds: ['b1'] },
  { id: 'm3', requiredAnnotationIds: [] },
];

describe('computeCompletion', () => {
  it('launch rule is complete immediately', () => {
    expect(computeCompletion('launch', models, emptyProgress()).complete).toBe(true);
  });
  it('open-all needs every model opened and ignores annotations', () => {
    let p = emptyProgress();
    p = markOpened(p, 'm1');
    p = markOpened(p, 'm2');
    expect(computeCompletion('open-all', models, p).complete).toBe(false);
    p = markOpened(p, 'm3');
    const s = computeCompletion('open-all', models, p);
    expect(s.complete).toBe(true);
    expect(s.fraction).toBe(1);
  });
  it('open-all-and-annotations needs every required annotation viewed', () => {
    let p = emptyProgress();
    for (const m of models) p = markOpened(p, m.id);
    expect(computeCompletion('open-all-and-annotations', models, p).complete).toBe(false);
    p = markViewed(p, 'm1', 'a1');
    p = markViewed(p, 'm1', 'a2');
    expect(computeCompletion('open-all-and-annotations', models, p).complete).toBe(false);
    p = markViewed(p, 'm2', 'b1');
    const s = computeCompletion('open-all-and-annotations', models, p);
    expect(s.complete).toBe(true);
    expect(s.annotationsViewed).toBe(3);
  });
  it('viewing annotations alone, without opening models, does not complete', () => {
    let p = emptyProgress();
    p = markViewed(p, 'm1', 'a1');
    expect(computeCompletion('open-all-and-annotations', models, p).complete).toBe(false);
  });
  it('is never complete with no models (except launch)', () => {
    expect(computeCompletion('open-all', [], emptyProgress()).complete).toBe(false);
  });
  it('markOpened / markViewed are idempotent and immutable', () => {
    const p0 = emptyProgress();
    const p1 = markOpened(p0, 'm1');
    expect(p0.opened).toEqual([]);
    expect(markOpened(p1, 'm1')).toBe(p1);
    const p2 = markViewed(p1, 'm1', 'a1');
    expect(markViewed(p2, 'm1', 'a1')).toBe(p2);
  });
});

describe('progress codec', () => {
  const codecModels = models.map((m) => ({ id: m.id, annotationIds: m.requiredAnnotationIds }));
  it('round-trips progress', () => {
    let p = emptyProgress();
    p = markOpened(p, 'm1');
    p = markOpened(p, 'm3');
    p = markViewed(p, 'm1', 'a2');
    p = markViewed(p, 'm2', 'b1');
    const raw = encodeProgress('hash123', codecModels, p);
    const out = decodeProgress(raw, 'hash123', codecModels)!;
    expect(out.contentMatched).toBe(true);
    expect(out.progress.opened.sort()).toEqual(['m1', 'm3']);
    expect(out.progress.viewed).toEqual({ m1: ['a2'], m2: ['b1'] });
    expect(out.progress.lastModelId).toBe('m3');
  });
  it('drops annotation progress when package content changed', () => {
    const p = markOpened(emptyProgress(), 'm1');
    const raw = encodeProgress('old', codecModels, p);
    const out = decodeProgress(raw, 'new', codecModels)!;
    expect(out.contentMatched).toBe(false);
    expect(out.progress.opened).toEqual([]);
  });
  it('rejects garbage', () => {
    expect(decodeProgress('', 'h', codecModels)).toBeNull();
    expect(decodeProgress('zzz', 'h', codecModels)).toBeNull();
    expect(decodeProgress('a1|h', 'h', codecModels)).toBeNull();
  });
  it('stays within the SCORM 1.2 suspend_data limit for large packages', () => {
    const big = Array.from({ length: 300 }, (_, i) => ({ id: `m${i}`, annotationIds: Array.from({ length: 400 }, (_, j) => `m${i}-a${j}`) }));
    let p = emptyProgress();
    for (const m of big) {
      p = markOpened(p, m.id);
      for (const a of m.annotationIds) p = markViewed(p, m.id, a);
    }
    const raw = encodeProgress('h', big, p);
    expect(raw.length).toBeLessThanOrEqual(LMS_SUSPEND_DATA_LIMIT);
    // Opened-models information survives the fallback.
    expect(decodeProgress(raw, 'h', big)!.progress.opened).toHaveLength(300);
  });
});
