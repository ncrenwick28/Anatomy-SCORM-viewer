/**
 * Imperative DOM layer that draws annotation markers over the 3D canvas.
 *
 * Markers are real <button> elements (screen-reader and pointer friendly) positioned with CSS
 * transforms. Only numbers sit on the model; the full label appears for the selected marker or on
 * hover/focus, so crowded models never fill the viewport with overlapping text. Markers whose
 * screen positions overlap are merged into a "+n" cluster that opens a short list.
 */

export interface DisplayMarker {
  id: string;
  /** 1-based number shown on the marker (matches the list). */
  num: number;
  label: string;
  x: number;
  y: number;
  selected: boolean;
  /** Drawn as a faint dashed "behind the surface" marker. */
  ghost: boolean;
}

interface Cluster {
  leader: DisplayMarker;
  members: DisplayMarker[];
}

const CLUSTER_RADIUS = 20;

export class MarkerLayer {
  readonly el: HTMLDivElement;
  private elements = new Map<string, HTMLButtonElement>();
  private popover: HTMLDivElement | null = null;
  private popoverOwner: string | null = null;
  private readonly onDocPointerDown = (e: PointerEvent) => {
    if (this.popover && !this.popover.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.av-marker--cluster')) this.closePopover();
  };

  constructor(
    container: HTMLElement,
    private readonly onSelect: (id: string) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'av-markers';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Annotation markers');
    container.appendChild(this.el);
    document.addEventListener('pointerdown', this.onDocPointerDown, true);
  }

  render(markers: DisplayMarker[], width: number): void {
    const seen = new Set<string>();
    const clusters = this.cluster(markers);
    for (const c of clusters) {
      const solo = c.members.length === 1;
      const key = solo ? c.leader.id : `cluster:${c.leader.id}`;
      seen.add(key);
      let btn = this.elements.get(key);
      if (!btn) {
        btn = this.create(solo);
        this.elements.set(key, btn);
        this.el.appendChild(btn);
      }
      this.update(btn, c, solo, width);
    }
    for (const [key, btn] of this.elements) {
      if (!seen.has(key)) {
        if (this.popoverOwner === key) this.closePopover();
        btn.remove();
        this.elements.delete(key);
      }
    }
  }

  clear() {
    this.render([], 0);
  }

  closePopover() {
    this.popover?.remove();
    this.popover = null;
    this.popoverOwner = null;
  }

  destroy() {
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
    this.closePopover();
    this.el.remove();
    this.elements.clear();
  }

  private cluster(markers: DisplayMarker[]): Cluster[] {
    const clusters: Cluster[] = [];
    // The selected marker is never merged; everything else is grouped greedily by screen distance.
    const selected = markers.filter((m) => m.selected);
    const others = markers.filter((m) => !m.selected);
    for (const m of selected) clusters.push({ leader: m, members: [m] });
    const grouped: Cluster[] = [];
    for (const m of others) {
      const hit = grouped.find((c) => Math.hypot(c.leader.x - m.x, c.leader.y - m.y) < CLUSTER_RADIUS);
      if (hit) hit.members.push(m);
      else grouped.push({ leader: m, members: [m] });
    }
    return clusters.concat(grouped);
  }

  private create(solo: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.className = 'av-marker';
    const dot = document.createElement('span');
    dot.className = 'av-marker__dot';
    btn.appendChild(dot);
    if (solo) {
      const label = document.createElement('span');
      label.className = 'av-marker__label';
      btn.appendChild(label);
    }
    return btn;
  }

  private update(btn: HTMLButtonElement, c: Cluster, solo: boolean, width: number): void {
    const { leader } = c;
    btn.style.transform = `translate3d(${leader.x.toFixed(1)}px, ${leader.y.toFixed(1)}px, 0)`;
    btn.style.zIndex = leader.selected ? '3' : leader.ghost ? '1' : '2';
    const dot = btn.firstElementChild as HTMLElement;
    if (solo) {
      const text = String(leader.num);
      if (dot.textContent !== text) dot.textContent = text;
      const label = btn.lastElementChild as HTMLElement;
      if (label.textContent !== leader.label) label.textContent = leader.label;
      const aria = `${leader.num}. ${leader.label}${leader.ghost ? ' (behind the surface)' : ''}`;
      if (btn.getAttribute('aria-label') !== aria) btn.setAttribute('aria-label', aria);
      btn.setAttribute('aria-pressed', String(leader.selected));
      btn.classList.toggle('av-marker--selected', leader.selected);
      btn.classList.toggle('av-marker--ghost', leader.ghost);
      btn.classList.toggle('av-marker--flip', leader.x > width - 200);
      btn.classList.remove('av-marker--cluster');
      btn.onclick = (e) => {
        e.stopPropagation();
        this.closePopover();
        this.onSelect(leader.id);
      };
    } else {
      const text = `+${c.members.length}`;
      if (dot.textContent !== text) dot.textContent = text;
      btn.classList.add('av-marker--cluster');
      btn.classList.remove('av-marker--selected', 'av-marker--ghost', 'av-marker--flip');
      btn.setAttribute('aria-label', `${c.members.length} annotations close together. Open a list to choose one.`);
      btn.removeAttribute('aria-pressed');
      btn.onclick = (e) => {
        e.stopPropagation();
        this.openPopover(`cluster:${leader.id}`, c, btn);
      };
    }
  }

  private openPopover(key: string, c: Cluster, anchor: HTMLElement) {
    if (this.popoverOwner === key) {
      this.closePopover();
      return;
    }
    this.closePopover();
    const pop = document.createElement('div');
    pop.className = 'av-cluster-pop';
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', 'Annotations at this spot');
    const ordered = [...c.members].sort((a, b) => a.num - b.num);
    for (const m of ordered) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.className = 'av-cluster-pop__item';
      const n = document.createElement('span');
      n.className = 'av-cluster-pop__num';
      n.textContent = String(m.num);
      const t = document.createElement('span');
      t.textContent = m.label;
      item.append(n, t);
      item.onclick = (e) => {
        e.stopPropagation();
        this.closePopover();
        this.onSelect(m.id);
      };
      pop.appendChild(item);
    }
    pop.onkeydown = (e) => {
      const items = Array.from(pop.querySelectorAll<HTMLButtonElement>('button'));
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closePopover();
        anchor.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(i + 1) % items.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(i - 1 + items.length) % items.length]?.focus();
      }
    };
    const t = anchor.style.transform;
    pop.style.transform = t;
    this.el.appendChild(pop);
    this.popover = pop;
    this.popoverOwner = key;
    (pop.querySelector('button') as HTMLButtonElement | null)?.focus();
  }
}
