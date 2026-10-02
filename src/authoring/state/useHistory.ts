import { useCallback, useEffect, useRef, useState } from 'react';
import { nowIso } from '../../shared/ids';
import type { Annotation } from '../../shared/types';
import { useStudio } from './store';

const LIMIT = 150;
const COALESCE_MS = 1500;

/**
 * Undo/redo for annotation changes (create, move, delete, and field edits). History is held for the open
 * model only; consecutive edits to the same field within a moment collapse into one step.
 */
export function useAnnotationHistory(modelId: string) {
  const past = useRef<Annotation[][]>([]);
  const future = useRef<Annotation[][]>([]);
  const last = useRef<{ key: string; t: number } | null>(null);
  const [, bump] = useState(0);
  const updateModel = useStudio((s) => s.updateModel);

  useEffect(() => {
    past.current = [];
    future.current = [];
    last.current = null;
    bump((n) => n + 1);
  }, [modelId]);

  const current = () => useStudio.getState().models.find((m) => m.id === modelId)?.annotations ?? [];

  const commit = useCallback(
    (next: Annotation[], coalesceKey?: string) => {
      const now = Date.now();
      const cont = coalesceKey && last.current?.key === coalesceKey && now - last.current.t < COALESCE_MS;
      if (!cont) {
        past.current.push(current());
        if (past.current.length > LIMIT) past.current.shift();
      }
      future.current = [];
      last.current = coalesceKey ? { key: coalesceKey, t: now } : null;
      updateModel(modelId, (m) => ({ ...m, annotations: next }));
      bump((n) => n + 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelId, updateModel],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return false;
    future.current.push(current());
    last.current = null;
    updateModel(modelId, (m) => ({ ...m, annotations: prev }));
    bump((n) => n + 1);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, updateModel]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return false;
    past.current.push(current());
    last.current = null;
    updateModel(modelId, (m) => ({ ...m, annotations: next }));
    bump((n) => n + 1);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, updateModel]);

  return { commit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}

export function patchAnnotation(list: Annotation[], id: string, patch: Partial<Annotation>): Annotation[] {
  return list.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: nowIso() } : a));
}
