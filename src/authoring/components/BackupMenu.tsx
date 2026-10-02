import { useEffect, useRef, useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Database, Download, HardDrive, Upload } from 'lucide-react';
import { BackupError, createBackup, parseBackup, restoreBackup, type ParsedBackup } from '../../storage/backup';
import { getDb } from '../state/db';
import { useStudio } from '../state/store';
import { toast } from '../state/toasts';
import { Modal } from './Modal';

function fmtBytes(n: number): string {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function BackupMenu() {
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const persistent = useStudio((s) => s.persistent);
  const modelCount = useStudio((s) => s.models.length);

  const refreshEstimate = () => void getDb().then((db) => db.estimate()).then(setEstimate);

  const backup = async () => {
    setBusy('Creating backup…');
    try {
      await useStudio.getState().flush();
      const db = await getDb();
      const r = await createBackup(db);
      download(r.blob, r.filename);
      toast.ok(`Backup downloaded: ${r.modelCount} model${r.modelCount === 1 ? '' : 's'}, ${fmtBytes(r.bytes)}. Keep it somewhere safe.`);
    } catch (e) {
      toast.error(e instanceof BackupError ? e.message : `The backup could not be created: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Menu.Root onOpenChange={(o) => o && refreshEstimate()}>
        <Menu.Trigger asChild>
          <button type="button" className="btn btn--sm" disabled={!!busy} data-testid="backup-menu">
            <Database /> {busy ?? 'Backup'}
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="menu" align="end" sideOffset={6}>
            <Menu.Item className="menu-item" onSelect={() => void backup()} data-testid="backup-download"><Download /> Download project backup</Menu.Item>
            <Menu.Item className="menu-item" onSelect={() => setRestoreOpen(true)} data-testid="backup-restore"><Upload /> Restore from backup…</Menu.Item>
            <Menu.Separator className="menu-sep" />
            <div className="menu-info" aria-live="polite">
              <HardDrive size={15} aria-hidden="true" />
              <span>
                {modelCount} model{modelCount === 1 ? '' : 's'} stored in this browser
                {estimate && <><br />Storage used: {fmtBytes(estimate.usage)} of about {fmtBytes(estimate.quota)}</>}
                <br />
                {persistent === true ? 'Protected from automatic clean-up' : persistent === false ? 'Browser may clear this data if space runs low — keep a backup' : ''}
              </span>
            </div>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <RestoreDialog open={restoreOpen} onOpenChange={setRestoreOpen} onBackup={backup} />
    </>
  );
}

function RestoreDialog({ open, onOpenChange, onBackup }: { open: boolean; onOpenChange: (o: boolean) => void; onBackup: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [understood, setUnderstood] = useState(false);
  const existing = useStudio((s) => s.models.length);

  useEffect(() => {
    if (open) {
      setParsed(null);
      setError(null);
      setFileName('');
      setMode('merge');
      setUnderstood(false);
      setWorking(null);
    }
  }, [open]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setParsed(null);
    setError(null);
    setWorking('Checking backup…');
    try {
      setParsed(await parseBackup(file));
    } catch (e) {
      setError(e instanceof BackupError ? e.message : `The file could not be read: ${(e as Error).message}`);
    } finally {
      setWorking(null);
    }
  };

  const run = async () => {
    if (!parsed) return;
    setWorking(mode === 'replace' ? 'Replacing project…' : 'Adding models…');
    try {
      const db = await getDb();
      await useStudio.getState().flush();
      const r = await restoreBackup(db, parsed, mode);
      await useStudio.getState().reload();
      toast.ok(mode === 'replace' ? `Project restored: ${r.models} model${r.models === 1 ? '' : 's'}.` : `Added ${r.models} model${r.models === 1 ? '' : 's'} from the backup.`);
      onOpenChange(false);
    } catch (e) {
      setError(`The restore failed and nothing was changed: ${(e as Error).message}`);
    } finally {
      setWorking(null);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Restore from a project backup"
      description="Choose a backup ZIP created by this application. The file is checked completely before anything changes."
      locked={!!working}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)} disabled={!!working}>Cancel</button>
          <button type="button" className={`btn ${mode === 'replace' ? 'btn--danger' : 'btn--primary'}`} disabled={!parsed || !!working || (mode === 'replace' && !understood && existing > 0)} onClick={() => void run()} data-testid="restore-confirm">
            {mode === 'replace' ? 'Replace project' : 'Add to project'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="restore-file">Backup file (.zip)</label>
        <input ref={fileRef} id="restore-file" className="input" type="file" accept=".zip,application/zip" onChange={(e) => void pick(e.target.files?.[0])} data-testid="restore-file" />
      </div>
      {working && <p role="status"><span className="spinner" /> {working}</p>}
      {error && <div className="callout callout--error" role="alert"><span>{error}</span></div>}
      {parsed && (
        <>
          <div className="callout callout--ok" role="status">
            <span>
              <strong>{fileName}</strong> is a valid backup: {parsed.manifest.models.length} model{parsed.manifest.models.length === 1 ? '' : 's'}, {parsed.manifest.models.reduce((s, m) => s + m.annotations.length, 0)} annotations, {fmtBytes(parsed.totalBytes)}. Created {new Date(parsed.manifest.exportedAt).toLocaleString('en-GB')}.
              {parsed.warnings.map((w) => <><br />{w}</>)}
            </span>
          </div>
          <fieldset className="field" style={{ marginTop: 14 }}>
            <legend className="label">How should it be restored?</legend>
            <label className="check"><input type="radio" name="restore-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} /><span><strong>Add to my current project</strong><br /><span className="hint">Imports the backup's models as new models. Nothing existing is changed.</span></span></label>
            <label className="check"><input type="radio" name="restore-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /><span><strong>Replace my current project</strong><br /><span className="hint">Deletes the {existing} model{existing === 1 ? '' : 's'} currently stored in this browser and everything else in the project.</span></span></label>
          </fieldset>
          {mode === 'replace' && existing > 0 && (
            <div className="callout callout--warn">
              <div>
                <label className="check"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /><span>I understand my current project will be permanently replaced.</span></label>
                <button type="button" className="btn btn--sm" style={{ marginTop: 8 }} onClick={() => void onBackup()}><Download /> Download a backup of the current project first</button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
