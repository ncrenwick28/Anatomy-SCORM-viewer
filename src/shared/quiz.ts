/**
 * Pure logic of the player's quiz ("click on the …"): choosing and ordering questions, deciding whether a
 * click on the model was the right structure, and summarising the result. No DOM, no Three.js, so it is
 * unit-tested directly.
 */
import type { Annotation, Vec3 } from './types';

export type Outcome = 'correct' | 'wrong' | 'skipped';

export interface QuizAnswer {
  annotationId: string;
  outcome: Outcome;
  /** The annotation the learner actually selected, when the click landed on another annotated structure. */
  clickedId: string | null;
  /** How the answer was given. 'list' is the pointer-free alternative. */
  method: 'model' | 'list' | 'skipped';
}

export interface PickLike {
  meshKey: string;
  position: Vec3;
}

export interface Judgement {
  correct: boolean;
  /** The annotation the click most plausibly meant, or null if it hit an unannotated structure. */
  clickedId: string | null;
}

const dist2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * Decides whether a click on the model identified the target annotation.
 * The click is matched to the annotations anchored on the same mesh; when several share one mesh, the one
 * nearest to the click point wins (positions are in that mesh's local space, so they are comparable).
 */
export function judgePick(targetId: string, pool: Annotation[], hit: PickLike): Judgement {
  const onMesh = pool.filter((a) => a.anchor.meshKey === hit.meshKey);
  if (onMesh.length === 0) return { correct: false, clickedId: null };
  let best = onMesh[0];
  let bestD = dist2(best.anchor.position, hit.position);
  for (const a of onMesh.slice(1)) {
    const d = dist2(a.anchor.position, hit.position);
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return { correct: best.id === targetId, clickedId: best.id };
}

/** Fisher–Yates shuffle; `rng` is injectable for tests. */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Picks `count` questions (all when omitted) from the annotations, in random order. */
export function buildQuestionIds(annotations: readonly Annotation[], count?: number, rng: () => number = Math.random): string[] {
  const ids = shuffle(annotations.map((a) => a.id), rng);
  return count && count > 0 ? ids.slice(0, Math.min(count, ids.length)) : ids;
}

/** Question-count choices offered on the start screen for a model with `n` annotations. */
export function countOptions(n: number): number[] {
  const opts = [5, 10, 20].filter((c) => c < n);
  return [...opts, n];
}

export interface QuizSummary {
  total: number;
  correct: number;
  wrong: number;
  skipped: number;
  /** Whole-number percentage, 0–100. */
  percent: number;
}

export function summarise(answers: readonly QuizAnswer[]): QuizSummary {
  const correct = answers.filter((a) => a.outcome === 'correct').length;
  const wrong = answers.filter((a) => a.outcome === 'wrong').length;
  const skipped = answers.filter((a) => a.outcome === 'skipped').length;
  const total = answers.length;
  return { total, correct, wrong, skipped, percent: total ? Math.round((correct / total) * 100) : 0 };
}

/** A short, encouraging message for the results screen. */
export function resultMessage(percent: number): string {
  if (percent === 100) return 'Perfect score – excellent work!';
  if (percent >= 80) return 'Very good – you know this model well.';
  if (percent >= 60) return 'Good progress – review the ones you missed and try again.';
  if (percent >= 40) return 'A fair start – use the recap to see where each structure is, then retry.';
  return 'Keep going – explore the model with the annotations on, then try the quiz again.';
}
