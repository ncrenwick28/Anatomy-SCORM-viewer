import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Block closing by overlay click / Escape (e.g. while an operation is running). */
  locked?: boolean;
}

export function Modal({ open, onOpenChange, title, description, children, footer, wide, locked }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => (!o && locked ? undefined : onOpenChange(o))}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className={`dlg-content ${wide ? 'dlg-content--wide' : ''}`} aria-describedby={description ? undefined : undefined} onInteractOutside={(e) => locked && e.preventDefault()} onEscapeKeyDown={(e) => locked && e.preventDefault()}>
          <div className="dlg-head">
            <Dialog.Title className="dlg-title">{title}</Dialog.Title>
            {!locked && (
              <Dialog.Close asChild>
                <button type="button" className="btn btn--ghost btn--icon btn--sm dlg-x" aria-label="Close"><X /></button>
              </Dialog.Close>
            )}
          </div>
          {description ? <Dialog.Description className="dlg-desc">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
          <div className="dlg-body">{children}</div>
          {footer && <div className="dlg-actions">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    return new Promise<boolean>((res) => {
      resolver.current = res;
    });
  }, []);
  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog.Root open={!!opts} onOpenChange={(o) => !o && close(false)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dlg-overlay" />
          <AlertDialog.Content className="dlg-content">
            <AlertDialog.Title className="dlg-title">{opts?.title}</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="dlg-desc">{opts?.message}</div>
            </AlertDialog.Description>
            <div className="dlg-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="btn" onClick={() => close(false)}>{opts?.cancelLabel ?? 'Cancel'}</button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button type="button" className={`btn ${opts?.danger ? 'btn--danger' : 'btn--primary'}`} onClick={() => close(true)}>{opts?.confirmLabel ?? 'Confirm'}</button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}
