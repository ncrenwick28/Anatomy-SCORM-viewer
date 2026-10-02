import { useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { newId } from '../../shared/ids';
import { DEFAULT_REGIONS, DEFAULT_SYSTEMS, type Category } from '../../shared/types';
import { useStudio } from '../state/store';
import { toast } from '../state/toasts';
import { Modal, useConfirm } from './Modal';

type Kind = 'regions' | 'systems';

function CategoryList({ kind, title }: { kind: Kind; title: string }) {
  const list = useStudio((s) => s.project[kind]);
  const models = useStudio((s) => s.models);
  const updateProject = useStudio((s) => s.updateProject);
  const updateModel = useStudio((s) => s.updateModel);
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const field = kind === 'regions' ? 'regionIds' : 'systemIds';
  const singular = kind === 'regions' ? 'region' : 'system';

  const used = (id: string) => models.filter((m) => m[field].includes(id)).length;

  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (list.some((c) => c.name.toLowerCase() === n.toLowerCase())) {
      toast.error(`There is already a ${singular} called “${n}”.`);
      return;
    }
    updateProject((p) => ({ ...p, [kind]: [...p[kind], { id: `${singular}-${newId().slice(0, 8)}`, name: n.slice(0, 60) }] }));
    setName('');
  };
  const rename = (c: Category, value: string) => {
    const v = value.trim();
    if (!v || v === c.name) return;
    updateProject((p) => ({ ...p, [kind]: p[kind].map((x) => (x.id === c.id ? { ...x, name: v.slice(0, 60) } : x)) }));
  };
  const remove = async (c: Category) => {
    const n = used(c.id);
    const ok = await confirm({
      title: `Delete the ${singular} “${c.name}”?`,
      message: n ? `${n} model${n === 1 ? ' is' : 's are'} assigned to it. They will keep their other categories, but lose this one.` : 'No models use it.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    models.filter((m) => m[field].includes(c.id)).forEach((m) => updateModel(m.id, (x) => ({ ...x, [field]: x[field].filter((i) => i !== c.id) })));
    updateProject((p) => ({ ...p, [kind]: p[kind].filter((x) => x.id !== c.id) }));
  };
  const restore = () => {
    const defaults = kind === 'regions' ? DEFAULT_REGIONS : DEFAULT_SYSTEMS;
    const missing = defaults.filter((d) => !list.some((c) => c.id === d.id));
    if (!missing.length) return toast.info('All the standard categories are already present.');
    updateProject((p) => ({ ...p, [kind]: [...p[kind], ...missing] }));
    toast.ok(`Restored ${missing.length} standard ${missing.length === 1 ? singular : kind}.`);
  };

  return (
    <section className="cat-manage" aria-labelledby={`cm-${kind}`}>
      <div className="cat-manage__head">
        <h3 id={`cm-${kind}`}>{title}</h3>
        <button type="button" className="btn btn--sm btn--ghost" onClick={restore}><RotateCcw /> Restore standard</button>
      </div>
      <ul className="cat-manage__list">
        {list.map((c) => (
          <li key={c.id}>
            <label className="sr-only" htmlFor={`cm-${c.id}`}>Name of {singular} {c.name}</label>
            <input id={`cm-${c.id}`} className="input" defaultValue={c.name} key={c.name} maxLength={60} onBlur={(e) => rename(c, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            <span className="hint cat-used">{used(c.id)} model{used(c.id) === 1 ? '' : 's'}</span>
            <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Delete ${singular} ${c.name}`} onClick={() => void remove(c)}><Trash2 /></button>
          </li>
        ))}
      </ul>
      <div className="cat-manage__add">
        <label className="sr-only" htmlFor={`cm-new-${kind}`}>New {singular} name</label>
        <input id={`cm-new-${kind}`} className="input" placeholder={`New ${singular}…`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" className="btn" onClick={add} disabled={!name.trim()}><Plus /> Add</button>
      </div>
    </section>
  );
}

export function CategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Body regions and systems" description="Rename, add or remove categories. Changes apply to the whole library and are saved automatically." wide footer={<button type="button" className="btn btn--primary" onClick={() => onOpenChange(false)}>Done</button>}>
      <div className="cat-manage-grid">
        <CategoryList kind="regions" title="Body regions" />
        <CategoryList kind="systems" title="Body systems" />
      </div>
    </Modal>
  );
}
