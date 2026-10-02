import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'info' | 'ok' | 'error';
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: Toast['kind'], message: string, ms?: number) => void;
  dismiss: (id: number) => void;
}

let next = 1;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message, ms) => {
    const id = next++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
    const timeout = ms ?? (kind === 'error' ? 9000 : 4500);
    setTimeout(() => get().dismiss(id), timeout);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (m: string) => useToasts.getState().push('info', m),
  ok: (m: string) => useToasts.getState().push('ok', m),
  error: (m: string) => useToasts.getState().push('error', m),
};
