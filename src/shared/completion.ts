import type { CompletionRule } from './types';

/**
 * Learner progress. Deliberately minimal so it can be stored compactly in the LMS.
 *
 * "Opened" – the learner opened the model in the viewer and it finished loading successfully.
 * "Viewed" (annotation) – the annotation's label and full description were displayed in the information
 *   panel (selected from the model or from the list). The quiz does not count towards completion.
 * "Active seconds" – time actively using the package, summed over every visit of this attempt (see tracker).
 */
export interface Progress {
  opened: string[];
  viewed: Record<string, string[]>;
  lastModelId: string | null;
  activeSeconds?: number;
}

export interface CompletionModel {
  id: string;
  /** Ids of annotations that count towards completion (annotation.required). */
  requiredAnnotationIds: string[];
}

export function emptyProgress(): Progress {
  return { opened: [], viewed: {}, lastModelId: null };
}

export interface CompletionSummary {
  rule: CompletionRule;
  complete: boolean;
  modelsOpened: number;
  modelsTotal: number;
  annotationsViewed: number;
  annotationsRequired: number;
  activeSeconds: number;
  /** Active time the package requires (0 = none). */
  requiredSeconds: number;
  /** 0–1 */
  fraction: number;
}

export function computeCompletion(rule: CompletionRule, models: CompletionModel[], progress: Progress, requiredSeconds = 0): CompletionSummary {
  const opened = new Set(progress.opened);
  let modelsOpened = 0;
  let annotationsRequired = 0;
  let annotationsViewed = 0;
  for (const m of models) {
    if (opened.has(m.id)) modelsOpened++;
    const viewed = new Set(progress.viewed[m.id] ?? []);
    for (const aid of m.requiredAnnotationIds) {
      annotationsRequired++;
      if (viewed.has(aid)) annotationsViewed++;
    }
  }
  const modelsTotal = models.length;
  let complete: boolean;
  let fraction: number;
  switch (rule) {
    case 'launch':
      complete = true;
      fraction = 1;
      break;
    case 'open-all':
      complete = modelsTotal > 0 && modelsOpened === modelsTotal;
      fraction = modelsTotal ? modelsOpened / modelsTotal : 0;
      break;
    case 'open-all-and-annotations':
    default: {
      complete = modelsTotal > 0 && modelsOpened === modelsTotal && annotationsViewed === annotationsRequired;
      const total = modelsTotal + annotationsRequired;
      fraction = total ? (modelsOpened + annotationsViewed) / total : 0;
      break;
    }
  }
  const activeSeconds = progress.activeSeconds ?? 0;
  if (requiredSeconds > 0) {
    // The time requirement is added to the rule: both must be met. Under "complete on launch" it is the only one.
    const timeFraction = Math.min(1, activeSeconds / requiredSeconds);
    complete = complete && activeSeconds >= requiredSeconds;
    fraction = rule === 'launch' ? timeFraction : (fraction + timeFraction) / 2;
  }
  return { rule, complete, modelsOpened, modelsTotal, annotationsViewed, annotationsRequired, activeSeconds, requiredSeconds, fraction };
}

/** Union of two progress records (progress only ever grows, so merging is always safe). */
export function mergeProgress(a: Progress, b: Progress, modelOrder: string[]): Progress {
  const opened = new Set([...a.opened, ...b.opened]);
  const viewed: Record<string, string[]> = {};
  for (const id of new Set([...Object.keys(a.viewed), ...Object.keys(b.viewed)])) viewed[id] = [...new Set([...(a.viewed[id] ?? []), ...(b.viewed[id] ?? [])])];
  return {
    opened: [...modelOrder.filter((id) => opened.has(id)), ...[...opened].filter((id) => !modelOrder.includes(id))],
    viewed,
    lastModelId: a.lastModelId ?? b.lastModelId,
    // Both copies count the same attempt's visits, so the larger total is the most complete one.
    ...(a.activeSeconds || b.activeSeconds ? { activeSeconds: Math.max(a.activeSeconds ?? 0, b.activeSeconds ?? 0) } : {}),
  };
}

export function markOpened(p: Progress, modelId: string): Progress {
  if (p.opened.includes(modelId) && p.lastModelId === modelId) return p;
  return {
    ...p,
    opened: p.opened.includes(modelId) ? p.opened : [...p.opened, modelId],
    lastModelId: modelId,
  };
}

export function markViewed(p: Progress, modelId: string, annotationId: string): Progress {
  const existing = p.viewed[modelId] ?? [];
  if (existing.includes(annotationId)) return p;
  return { ...p, viewed: { ...p.viewed, [modelId]: [...existing, annotationId] } };
}

export const COMPLETION_RULE_LABELS: Record<CompletionRule, { title: string; detail: string }> = {
  launch: {
    title: 'Complete on launch',
    detail: 'The package is marked complete as soon as a learner launches it. Nothing else is tracked.',
  },
  'open-all': {
    title: 'Open every model',
    detail:
      'Complete once the learner has opened every included model. "Opened" means the model was selected from the gallery and finished loading in the viewer.',
  },
  'open-all-and-annotations': {
    title: 'Open every model and view every required annotation',
    detail:
      'Complete once every included model has been opened and every annotation marked "required" has been viewed. An annotation counts as "viewed" when its label and description were shown in the information panel, by selecting it on the model or in the list. The quiz does not count towards completion.',
  },
};
