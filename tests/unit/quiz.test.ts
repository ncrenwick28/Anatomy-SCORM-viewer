import { describe, expect, it } from 'vitest';
import type { Annotation } from '../../src/shared/types';
import { buildQuestionIds, countOptions, judgePick, resultMessage, shuffle, summarise, type QuizAnswer } from '../../src/shared/quiz';

const ann = (id: string, meshKey: string, position: [number, number, number] = [0, 0, 0]): Annotation => ({
  id,
  label: id.toUpperCase(),
  description: '',
  category: '',
  link: null,
  required: false,
  anchor: { meshKey, meshName: meshKey, position, normal: [0, 1, 0] },
  createdAt: '',
  updatedAt: '',
});

describe('judgePick', () => {
  const pool = [ann('a', '0/0'), ann('b', '0/1'), ann('c', '0/1', [10, 0, 0])];

  it('is correct when the click lands on the only annotated mesh of the target', () => {
    expect(judgePick('a', pool, { meshKey: '0/0', position: [5, 5, 5] })).toEqual({ correct: true, clickedId: 'a' });
  });
  it('is wrong, and names what was clicked, when another annotated structure is hit', () => {
    expect(judgePick('a', pool, { meshKey: '0/1', position: [0.1, 0, 0] })).toEqual({ correct: false, clickedId: 'b' });
  });
  it('is wrong with no clicked annotation when an unannotated structure is hit', () => {
    expect(judgePick('a', pool, { meshKey: '0/9', position: [0, 0, 0] })).toEqual({ correct: false, clickedId: null });
  });
  it('uses the nearest annotation when several share one mesh', () => {
    expect(judgePick('c', pool, { meshKey: '0/1', position: [9, 0, 0] }).correct).toBe(true);
    expect(judgePick('c', pool, { meshKey: '0/1', position: [1, 0, 0] })).toEqual({ correct: false, clickedId: 'b' });
  });
});

describe('question selection', () => {
  const items = Array.from({ length: 12 }, (_, i) => ann(`q${i}`, `0/${i}`));
  const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

  it('shuffles without losing or duplicating items, and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, seq(0.1, 0.9, 0.5, 0.3));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
  it('returns every question by default and a distinct subset when asked', () => {
    expect(new Set(buildQuestionIds(items)).size).toBe(12);
    const some = buildQuestionIds(items, 5);
    expect(some).toHaveLength(5);
    expect(new Set(some).size).toBe(5);
    expect(buildQuestionIds(items, 99)).toHaveLength(12);
  });
  it('offers sensible question counts', () => {
    expect(countOptions(3)).toEqual([3]);
    expect(countOptions(7)).toEqual([5, 7]);
    expect(countOptions(25)).toEqual([5, 10, 20, 25]);
    expect(countOptions(5)).toEqual([5]);
  });
});

describe('summary', () => {
  const a = (outcome: QuizAnswer['outcome']): QuizAnswer => ({ annotationId: outcome, outcome, clickedId: null, method: 'model' });
  it('counts and rounds', () => {
    const s = summarise([a('correct'), a('correct'), a('wrong'), a('skipped'), a('correct'), a('correct'), a('correct')]);
    expect(s).toEqual({ total: 7, correct: 5, wrong: 1, skipped: 1, percent: 71 });
  });
  it('handles an empty quiz', () => {
    expect(summarise([]).percent).toBe(0);
  });
  it('has a message for every band', () => {
    for (const p of [0, 30, 50, 70, 90, 100]) expect(resultMessage(p).length).toBeGreaterThan(5);
  });
});
