import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Focus, Pencil } from 'lucide-react';
import type { StructureNode } from '../viewer/meshKeys';
import type { ViewerCore } from '../viewer/ViewerCore';

interface Props {
  viewer: ViewerCore | null;
  structure: StructureNode[];
  labels?: Record<string, string>;
  /** Authoring: allow renaming a structure's display name. */
  onRename?: (key: string, name: string) => void;
  /** Re-render trigger from viewer visibility events. */
  tick: number;
}

function flatten(nodes: StructureNode[], out: Map<string, StructureNode> = new Map()) {
  for (const n of nodes) {
    out.set(n.key, n);
    flatten(n.children, out);
  }
  return out;
}

/**
 * Lists the separate meshes in the model with visibility and isolate controls. A single unsegmented
 * mesh cannot be split into anatomical parts; the panel says so rather than implying otherwise.
 */
export function StructurePanel({ viewer, structure, labels = {}, onRename, tick }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const nodes = useMemo(() => flatten(structure), [structure]);
  const meshTotal = useMemo(() => [...nodes.values()].filter((n) => n.isMesh).length, [nodes]);
  void tick;
  const hiddenKeys = new Set(viewer?.getHiddenKeys() ?? []);
  const isolated = viewer?.getIsolatedKey() ?? null;
  const hiddenMeshCount = viewer ? [...nodes.values()].filter((n) => n.isMesh && !viewer.isNodeVisible(n.key)).length : 0;

  const setVisible = (key: string, visible: boolean) => {
    if (!viewer) return;
    if (!visible) {
      viewer.setNodeHidden(key, true);
      return;
    }
    // Making something visible inside a hidden group: reveal the group but keep its other children hidden.
    const path = key.split('/');
    const hiddenAncestors: string[] = [];
    for (let i = 1; i < path.length; i++) {
      const k = path.slice(0, i).join('/');
      if (hiddenKeys.has(k)) hiddenAncestors.push(k);
    }
    for (const ak of hiddenAncestors) {
      viewer.setNodeHidden(ak, false);
      const anc = nodes.get(ak);
      const onPath = path.slice(0, ak.split('/').length + 1).join('/');
      anc?.children.forEach((c) => {
        if (c.key !== onPath) viewer.setNodeHidden(c.key, true);
      });
    }
    viewer.setNodeHidden(key, false);
  };

  // Meshes often share a name (e.g. several "Part"); number the repeats so rows can be told apart.
  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    const out = new Map<string, string>();
    const all = [...nodes.values()];
    const counts = new Map<string, number>();
    for (const n of all) counts.set(labels[n.key] || n.name, (counts.get(labels[n.key] || n.name) ?? 0) + 1);
    for (const n of all) {
      const base = labels[n.key] || n.name;
      if ((counts.get(base) ?? 0) > 1) {
        const i = (seen.get(base) ?? 0) + 1;
        seen.set(base, i);
        out.set(n.key, `${base} (${i})`);
      }
    }
    return out;
  }, [nodes, labels]);
  const displayName = (n: StructureNode) => dupes.get(n.key) ?? (labels[n.key] || n.name);

  const renderNode = (n: StructureNode): React.ReactNode => {
    const visible = viewer?.isNodeVisible(n.key) ?? true;
    const isGroup = !n.isMesh && n.children.length > 0;
    const open = !collapsed.has(n.key);
    const name = displayName(n);
    return (
      <li key={n.key}>
        <div className={`struct-row ${visible ? '' : 'is-off'} ${isolated === n.key ? 'is-isolated' : ''}`} style={{ paddingLeft: 6 + n.depth * 16 }}>
          {isGroup ? (
            <button type="button" className="btn btn--ghost btn--icon btn--sm struct-twisty" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`} onClick={() => setCollapsed((s) => { const c = new Set(s); open ? c.add(n.key) : c.delete(n.key); return c; })}>
              {open ? <ChevronDown /> : <ChevronRight />}
            </button>
          ) : (
            <span className="struct-twisty" aria-hidden="true" />
          )}
          <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`${visible ? 'Hide' : 'Show'} ${name}`} title={visible ? 'Hide' : 'Show'} onClick={() => setVisible(n.key, !visible)}>
            {visible ? <Eye /> : <EyeOff />}
          </button>
          {editing === n.key ? (
            <input
              className="input struct-edit"
              autoFocus
              defaultValue={name}
              aria-label={`Display name for ${n.name}`}
              maxLength={120}
              onBlur={(e) => { onRename?.(n.key, e.target.value.trim() === n.name ? '' : e.target.value.trim()); setEditing(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }}
            />
          ) : (
            <span className="struct-name" title={name}>
              {name}
              {isGroup && <span className="hint"> · {n.meshCount}</span>}
            </span>
          )}
          {onRename && editing !== n.key && (
            <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Rename ${name}`} title="Rename" onClick={() => setEditing(n.key)}><Pencil /></button>
          )}
          <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={isolated === n.key ? `Stop isolating ${name}` : `Isolate ${name}`} title={isolated === n.key ? 'Show everything again' : 'Isolate (hide everything else)'} onClick={() => viewer?.isolate(isolated === n.key ? null : n.key)}>
            <Focus />
          </button>
        </div>
        {isGroup && open && <ul className="struct-children" aria-label={`${name} contents`}>{n.children.map(renderNode)}</ul>}
      </li>
    );
  };

  return (
    <div className="struct">
      <div className="struct-head">
        <span className="hint" role="status">{meshTotal} {meshTotal === 1 ? 'mesh' : 'meshes'}{hiddenMeshCount ? ` · ${hiddenMeshCount} hidden` : ''}</span>
        <button type="button" className="btn btn--sm" disabled={!hiddenMeshCount && !isolated} onClick={() => viewer?.showAllStructures()}>Show all</button>
      </div>
      {meshTotal <= 1 && (
        <div className="callout callout--info" role="note">
          <span>This model is a single mesh, so it cannot be split into separate structures. Models need to be exported from a modelling tool with each structure as its own mesh.</span>
        </div>
      )}
      <ul aria-label="Model structures" className="struct-tree">{structure.map(renderNode)}</ul>
    </div>
  );
}
