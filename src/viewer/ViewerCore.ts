import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Annotation, AnnotationAnchor, BackgroundSetting, CameraView, LightingSettings, Vec3 } from '../shared/types';
import { DEFAULT_BACKGROUND, DEFAULT_LIGHTING } from '../shared/types';
import { DEFAULT_FOV, DEFAULT_VIEW_DIRECTION, frameBox } from './framing';
import { disposeModel, loadModelSource } from './loader';
import { MarkerLayer, type DisplayMarker } from './MarkerLayer';
import { anchorFromHit, anchorNormalToWorld, anchorToWorld, findByKey, keyOf, resolveAnchorMesh, type StructureNode } from './meshKeys';
import type { LoadProgress, LoadedModelInfo, MarkerState, ModelSource, PickResult, ViewerEvents, ViewerOptions } from './types';

type Listener<K extends keyof ViewerEvents> = (payload: ViewerEvents[K]) => void;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rad = (d: number) => (d * Math.PI) / 180;

interface Flight {
  start: number;
  duration: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
}

/**
 * Framework-independent 3D viewer used by both the authoring application and the student player.
 *
 * Responsibilities: loading a glTF/GLB, orbit/pan/zoom with sensible limits, lighting and background,
 * the structure tree (visibility / isolate), picking surface points, drawing annotation markers with
 * occlusion handling, saved camera views, thumbnails and clean disposal.
 */
export class ViewerCore {
  static readonly instances = new Set<ViewerCore>();

  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x8794a3, DEFAULT_LIGHTING.ambient);
  private readonly key = new THREE.DirectionalLight(0xffffff, DEFAULT_LIGHTING.key);
  private readonly markers: MarkerLayer;
  private readonly previewEl: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTexture: THREE.Texture | null = null;

  private root: THREE.Group | null = null;
  private wrapper = new THREE.Group();
  private box = new THREE.Box3();
  private radius = 1;
  private boundsCenter = new THREE.Vector3();
  private structure: StructureNode[] = [];
  private initialView: CameraView | null = null;
  private defaultView: CameraView | null = null;
  private lighting: LightingSettings = { ...DEFAULT_LIGHTING };
  private background: BackgroundSetting = { ...DEFAULT_BACKGROUND };

  private hiddenKeys = new Set<string>();
  private isolatedKey: string | null = null;
  private pickables: THREE.Mesh[] = [];

  private annotations: Annotation[] = [];
  private anchorMeshes = new Map<string, THREE.Mesh>();
  private selectedId: string | null = null;
  private showMarkers = true;
  private showHiddenMarkers = false;
  private occlusion = new Map<string, boolean>();
  private markerStates: Record<string, MarkerState> = {};
  private markerStateSig = '';
  private occlusionDirty = true;
  private lastOcclusion = 0;

  private pickMode = false;
  private width = 1;
  private height = 1;
  private dirty = true;
  private raf = 0;
  private disposed = false;
  private flight: Flight | null = null;
  private readonly listeners = new Map<string, Set<(p: never) => void>>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpV = new THREE.Vector3();
  private down: { x: number; y: number; t: number; pointers: number } | null = null;
  private activePointers = new Set<number>();
  private previewRaf = 0;
  private lastPointer: { x: number; y: number } | null = null;
  private pixelRatioCap = 2;
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  constructor(container: HTMLElement, private readonly options: ViewerOptions = {}) {
    this.container = container;
    container.classList.add('av-viewer');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'group');
    this.canvas.setAttribute('aria-roledescription', '3D model viewer');
    this.canvas.setAttribute(
      'aria-label',
      '3D model viewer. Arrow keys rotate, Shift plus arrow keys pan, plus and minus zoom, 0 resets the view.',
    );
    container.appendChild(this.canvas);

    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.01, 1000);
    this.camera.position.set(0, 0, 5);
    this.scene.add(this.hemi, this.key, this.key.target, this.wrapper);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 0.9;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.onCameraChange());
    this.controls.addEventListener('start', () => {
      this.flight = null;
      this.markers.closePopover();
    });

    this.markers = new MarkerLayer(container, (id) => this.emit('markerClick', { id }));
    this.previewEl = document.createElement('div');
    this.previewEl.className = 'av-preview';
    this.previewEl.setAttribute('aria-hidden', 'true');
    container.appendChild(this.previewEl);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('keydown', this.onKeyDown);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);

    if (!options.offscreen && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    this.setLighting(DEFAULT_LIGHTING);
    this.setBackground(DEFAULT_BACKGROUND);
    this.resize();
    ViewerCore.instances.add(this);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ───────────────────────────── events ─────────────────────────────
  on<K extends keyof ViewerEvents>(type: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as (p: never) => void);
    return () => set!.delete(fn as (p: never) => void);
  }

  private emit<K extends keyof ViewerEvents>(type: K, payload: ViewerEvents[K]): void {
    this.listeners.get(type)?.forEach((fn) => (fn as Listener<K>)(payload));
  }

  // ───────────────────────────── loading ─────────────────────────────
  async loadModel(source: ModelSource, opts: { onProgress?: (p: LoadProgress) => void; signal?: AbortSignal } = {}): Promise<LoadedModelInfo> {
    this.clearModel();
    const result = await loadModelSource(source, { dracoPath: this.options.dracoPath, ...opts });
    if (this.disposed) {
      disposeModel(result.root);
      throw new DOMException('Viewer disposed', 'AbortError');
    }
    this.root = result.root;
    this.wrapper.add(result.root);
    this.structure = result.info.structure;
    this.box = new THREE.Box3().setFromObject(result.root);
    const sphere = this.box.getBoundingSphere(new THREE.Sphere());
    this.radius = Math.max(sphere.radius, 1e-4);
    this.boundsCenter.copy(sphere.center);
    this.controls.minDistance = this.radius * 0.08;
    this.controls.maxDistance = this.radius * 12;
    this.hiddenKeys.clear();
    this.isolatedKey = null;
    this.initialView = frameBox(this.box, DEFAULT_VIEW_DIRECTION, this.camera.fov, this.camera.aspect);
    this.rebuildPickables();
    this.resolveAnchors();
    this.resetView(false);
    this.markDirty(true);
    return result.info;
  }

  hasModel(): boolean {
    return !!this.root;
  }

  getStructure(): StructureNode[] {
    return this.structure;
  }

  getRoot(): THREE.Group | null {
    return this.root;
  }

  getBounds(): { center: Vec3; size: Vec3; radius: number } {
    const c = this.box.getCenter(new THREE.Vector3());
    const s = this.box.getSize(new THREE.Vector3());
    return { center: [c.x, c.y, c.z], size: [s.x, s.y, s.z], radius: this.radius };
  }

  clearModel(): void {
    if (this.root) {
      this.wrapper.remove(this.root);
      disposeModel(this.root);
      this.root = null;
    }
    this.structure = [];
    this.pickables = [];
    this.anchorMeshes.clear();
    this.occlusion.clear();
    this.markers.clear();
    this.markerStates = {};
    this.markerStateSig = '';
  }

  // ─────────────────────────── camera & views ───────────────────────────
  /** Camera as it is right now. */
  getCameraView(): CameraView {
    const q = this.camera.quaternion;
    const t = this.controls.target;
    return {
      position: this.camera.position.toArray() as Vec3,
      target: [t.x, t.y, t.z],
      up: this.camera.up.toArray() as Vec3,
      quaternion: [q.x, q.y, q.z, q.w],
      zoom: this.camera.zoom,
      fov: this.camera.fov,
      aspect: this.camera.aspect,
    };
  }

  /** The view students see first: the saved default, else an automatic frame of the whole model. */
  setDefaultView(view: CameraView | null): void {
    this.defaultView = view;
  }

  getEffectiveDefaultView(): CameraView | null {
    return this.defaultView ?? this.initialView;
  }

  resetView(animate = true): void {
    const v = this.getEffectiveDefaultView();
    if (v) this.applyView(v, { animate });
  }

  /**
   * Moves the camera to a saved view. When this screen is narrower than the one the view was saved on
   * the camera backs off so the same width of the model remains visible ("preserveFraming").
   */
  applyView(view: CameraView, opts: { animate?: boolean; preserveFraming?: boolean } = {}): void {
    const { animate = false, preserveFraming = true } = opts;
    const target = new THREE.Vector3(...view.target);
    const pos = new THREE.Vector3(...view.position);
    if (preserveFraming && view.aspect > this.camera.aspect + 1e-3) {
      const factor = Math.min(view.aspect / this.camera.aspect, 3);
      pos.sub(target).multiplyScalar(factor).add(target);
    }
    this.camera.up.set(...view.up);
    this.camera.fov = view.fov;
    this.camera.zoom = view.zoom;
    this.camera.updateProjectionMatrix();
    this.flyTo(pos, target, animate && !reducedMotion() ? 550 : 0);
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, duration: number): void {
    if (duration <= 0) {
      this.flight = null;
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.camera.lookAt(target);
      this.controls.update();
      this.updateClipping();
      this.markDirty(true);
      return;
    }
    this.flight = {
      start: performance.now(),
      duration,
      fromPos: this.camera.position.clone(),
      toPos: pos,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
    };
    this.markDirty();
  }

  rotateBy(azimuthDeg: number, polarDeg: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta -= rad(azimuthDeg);
    sph.phi = THREE.MathUtils.clamp(sph.phi - rad(polarDeg), 0.05, Math.PI - 0.05);
    offset.setFromSpherical(sph);
    this.flight = null;
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.markDirty(true);
  }

  zoomBy(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const d = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    offset.setLength(d);
    this.flight = null;
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.markDirty(true);
  }

  /** Pan in screen space; dx/dy are fractions of the visible height. */
  panBy(dx: number, dy: number): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const visibleH = 2 * Math.tan(rad(this.camera.fov / 2)) * dist;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const move = right.multiplyScalar(-dx * visibleH).add(up.multiplyScalar(dy * visibleH));
    this.flight = null;
    this.camera.position.add(move);
    this.controls.target.add(move);
    this.controls.update();
    this.markDirty(true);
  }

  private clampTarget(): void {
    if (!this.root) return;
    const t = this.controls.target;
    const pad = this.radius * 0.9;
    const min = this.box.min.clone().subScalar(pad);
    const max = this.box.max.clone().addScalar(pad);
    const clamped = t.clone().clamp(min, max);
    if (!clamped.equals(t)) {
      const delta = clamped.clone().sub(t);
      t.copy(clamped);
      this.camera.position.add(delta);
    }
  }

  private updateClipping(): void {
    // Clip planes come from the distance to the model's bounding sphere, not to the orbit target: panning moves
    // the target away from the model's centre, and a target-based far plane would then cut off the far side.
    const d = this.camera.position.distanceTo(this.boundsCenter);
    const near = Math.max(this.radius * 0.001, (d - this.radius) * 0.9);
    const far = d + this.radius * 1.15;
    if (Math.abs(this.camera.near - near) > 1e-9 || Math.abs(this.camera.far - far) > 1e-9) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  private onCameraChange(): void {
    this.clampTarget();
    this.updateClipping();
    this.occlusionDirty = true;
    this.markDirty();
    this.emit('cameraMoved', undefined);
  }

  // ─────────────────────── appearance: light & background ───────────────────────
  setBackground(bg: BackgroundSetting): void {
    this.background = bg;
    this.container.style.background =
      bg.type === 'solid' ? bg.color : `linear-gradient(180deg, ${bg.top} 0%, ${bg.bottom} 100%)`;
    this.markDirty();
  }

  setLighting(l: LightingSettings): void {
    this.lighting = { ...l };
    this.renderer.toneMappingExposure = l.exposure;
    this.hemi.intensity = l.ambient;
    this.key.intensity = l.key;
    if (l.environment && !this.envTexture) {
      this.pmrem ??= new THREE.PMREMGenerator(this.renderer);
      const env = new RoomEnvironment();
      this.envTexture = this.pmrem.fromScene(env, 0.04).texture;
      env.dispose();
    }
    this.scene.environment = l.environment ? this.envTexture : null;
    this.scene.environmentIntensity = 0.45;
    this.updateKeyLight();
    this.markDirty();
  }

  getLighting(): LightingSettings {
    return { ...this.lighting };
  }

  getBackground(): BackgroundSetting {
    return this.background;
  }

  private updateKeyLight(): void {
    const az = rad(this.lighting.keyAzimuth);
    const el = rad(this.lighting.keyElevation);
    const v = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    if (this.lighting.headlight) v.applyQuaternion(this.camera.quaternion);
    this.key.position.copy(this.controls.target).addScaledVector(v, this.radius * 4);
    this.key.target.position.copy(this.controls.target);
    this.key.target.updateMatrixWorld();
  }

  // ───────────────────────────── structure ─────────────────────────────
  getHiddenKeys(): string[] {
    return [...this.hiddenKeys];
  }

  getIsolatedKey(): string | null {
    return this.isolatedKey;
  }

  setHiddenKeys(keys: string[]): void {
    this.hiddenKeys = new Set(keys);
    this.applyVisibility();
  }

  setNodeHidden(key: string, hidden: boolean): void {
    if (hidden) this.hiddenKeys.add(key);
    else this.hiddenKeys.delete(key);
    this.applyVisibility();
  }

  isolate(key: string | null): void {
    this.isolatedKey = key;
    this.applyVisibility();
  }

  showAllStructures(): void {
    this.hiddenKeys.clear();
    this.isolatedKey = null;
    this.applyVisibility();
  }

  /** Keys of every mesh that is not currently drawn (hidden directly, via a group, or by isolation). */
  getEffectiveHiddenMeshKeys(): string[] {
    const out: string[] = [];
    const root = this.root;
    root?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !this.effectivelyVisible(o)) {
        const k = keyOf(root, o);
        if (k !== null) out.push(k);
      }
    });
    return out;
  }

  isNodeVisible(key: string): boolean {
    if (!this.root) return false;
    const node = findByKey(this.root, key);
    return !!node && this.effectivelyVisible(node);
  }

  private effectivelyVisible(obj: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = obj;
    while (cur && cur !== this.wrapper) {
      if (!cur.visible) return false;
      cur = cur.parent;
    }
    return true;
  }

  private applyVisibility(): void {
    const root = this.root;
    if (!root) return;
    root.traverse((o) => (o.visible = true));
    let keep: Set<THREE.Object3D> | null = null;
    if (this.isolatedKey !== null) {
      const target = findByKey(root, this.isolatedKey);
      if (target) {
        keep = new Set<THREE.Object3D>();
        target.traverse((o) => keep!.add(o));
        let p: THREE.Object3D | null = target;
        while (p) {
          keep.add(p);
          p = p.parent;
        }
        root.traverse((o) => {
          if (o !== root && !keep!.has(o)) o.visible = false;
        });
      } else {
        this.isolatedKey = null;
      }
    }
    for (const k of this.hiddenKeys) {
      const node = findByKey(root, k);
      if (!node) continue;
      if (keep && keep.has(node) && this.isolatedKey !== null) {
        // Hiding something inside the isolated structure is allowed, but never the isolated node itself or its ancestors.
        const iso = findByKey(root, this.isolatedKey);
        let isAncestorOrSelf = false;
        let p: THREE.Object3D | null = iso;
        while (p) {
          if (p === node) isAncestorOrSelf = true;
          p = p.parent;
        }
        if (isAncestorOrSelf) continue;
      }
      node.visible = false;
    }
    this.rebuildPickables();
    this.occlusionDirty = true;
    this.markDirty(true);
    this.emit('visibility', { hiddenKeys: this.getHiddenKeys(), isolatedKey: this.isolatedKey });
  }

  private rebuildPickables(): void {
    const list: THREE.Mesh[] = [];
    this.root?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && this.effectivelyVisible(m)) list.push(m);
    });
    this.pickables = list;
  }

  // ───────────────────────────── annotations ─────────────────────────────
  setAnnotations(list: Annotation[]): void {
    this.annotations = list;
    this.resolveAnchors();
    this.occlusionDirty = true;
    this.markDirty(true);
  }

  private resolveAnchors(): void {
    this.anchorMeshes.clear();
    if (!this.root) return;
    for (const a of this.annotations) {
      const m = resolveAnchorMesh(this.root, a.anchor);
      if (m) this.anchorMeshes.set(a.id, m);
    }
  }

  /** True when every annotation's mesh can be found in the loaded model. */
  anchorsResolved(): { id: string; ok: boolean }[] {
    return this.annotations.map((a) => ({ id: a.id, ok: this.anchorMeshes.has(a.id) }));
  }

  /**
   * Checks that every annotation still sits on its structure: the mesh must exist and the stored point
   * must lie on (within 1% of the model radius of) that mesh's surface.
   */
  verifyAnchors(): { id: string; label: string; ok: boolean; reason?: string }[] {
    return this.annotations.map((a) => {
      const mesh = this.anchorMeshes.get(a.id);
      if (!mesh) return { id: a.id, label: a.label, ok: false, reason: `the structure "${a.anchor.meshName || a.anchor.meshKey}" it was attached to was not found in the model file.` };
      const bvh = (mesh.geometry as THREE.BufferGeometry & { boundsTree?: { closestPointToPoint: (p: THREE.Vector3, t?: object) => { distance: number } | null } }).boundsTree;
      if (!bvh) return { id: a.id, label: a.label, ok: true };
      mesh.updateWorldMatrix(true, false);
      const hit = bvh.closestPointToPoint(new THREE.Vector3(a.anchor.position[0], a.anchor.position[1], a.anchor.position[2]), {});
      const dist = (hit?.distance ?? 0) * mesh.matrixWorld.getMaxScaleOnAxis();
      if (dist > Math.max(this.radius * 0.01, 1e-6)) {
        return { id: a.id, label: a.label, ok: false, reason: `its position no longer lies on the surface of the model (it is ${dist.toPrecision(2)} units away), so it would appear to float.` };
      }
      return { id: a.id, label: a.label, ok: true };
    });
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.occlusionDirty = true;
    this.markDirty(true);
  }

  setMarkersVisible(v: boolean): void {
    this.showMarkers = v;
    this.markDirty(true);
  }

  setShowHiddenMarkers(v: boolean): void {
    this.showHiddenMarkers = v;
    this.markDirty(true);
  }

  /** Re-renders marker labels (e.g. after self-study conceal/reveal changes). */
  refreshMarkers(): void {
    this.markDirty(true);
  }

  getMarkerStates(): Record<string, MarkerState> {
    return this.markerStates;
  }

  /** World position of an annotation, if resolvable. */
  getAnnotationWorldPosition(id: string): THREE.Vector3 | null {
    const a = this.annotations.find((x) => x.id === id);
    if (!a || !this.root) return null;
    return anchorToWorld(this.root, a.anchor);
  }

  /**
   * Turns the camera to look at an annotation along its surface normal, so a marker on the far side of
   * the model comes into view. Keeps the current distance within sensible bounds.
   */
  focusAnnotation(id: string, animate = true): boolean {
    const a = this.annotations.find((x) => x.id === id);
    if (!a || !this.root) return false;
    const mesh = this.anchorMeshes.get(id);
    if (!mesh || !this.effectivelyVisible(mesh)) return false;
    const p = anchorToWorld(this.root, a.anchor);
    const n = anchorNormalToWorld(this.root, a.anchor);
    if (!p || !n) return false;
    const dist = THREE.MathUtils.clamp(this.camera.position.distanceTo(this.controls.target), this.radius * 0.6, this.radius * 2.2);
    // Blend the normal with the current view direction so the turn is never disorienting.
    const current = this.camera.position.clone().sub(this.controls.target).normalize();
    const dir = n.clone().multiplyScalar(0.85).addScaledVector(current, 0.15).normalize();
    const pos = p.clone().addScaledVector(dir, dist);
    this.flyTo(pos, p.clone(), animate && !reducedMotion() ? 600 : 0);
    return true;
  }

  /** Called when a selection should make sure the marker can be seen. */
  ensureMarkerVisible(id: string): void {
    this.updateOcclusionNow();
    const state = this.markerStates[id];
    if (state === 'occluded' || state === 'offscreen') this.focusAnnotation(id, true);
  }

  // ───────────────────────────── picking ─────────────────────────────
  setPickMode(on: boolean): void {
    this.pickMode = on;
    this.container.classList.toggle('av-viewer--picking', on);
    if (!on) this.previewEl.style.display = 'none';
  }

  private pointerToNdc(clientX: number, clientY: number): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
  }

  private raycastNdc(ndc: THREE.Vector2): THREE.Intersection | null {
    if (!this.root) return null;
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    (this.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    return hits[0] ?? null;
  }

  /** Picks the surface point under a client position. */
  pickAt(clientX: number, clientY: number): AnnotationAnchor | null {
    const hit = this.raycastNdc(this.pointerToNdc(clientX, clientY));
    return hit && this.root ? anchorFromHit(this.root, hit) : null;
  }

  /** Keyboard / precision-free alternative: the surface point at the centre of the viewport. */
  pickAtCentre(): AnnotationAnchor | null {
    const hit = this.raycastNdc(new THREE.Vector2(0, 0));
    return hit && this.root ? anchorFromHit(this.root, hit) : null;
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    this.activePointers.add(e.pointerId);
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), pointers: this.activePointers.size };
    if (this.activePointers.size > 1 && this.down) this.down.pointers = 2;
  };

  private readonly onPointerCancel = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    this.down = null;
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    const d = this.down;
    this.down = null;
    if (!d || d.pointers > 1 || e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 700) return;
    if (this.pickMode) {
      const anchor = this.pickAt(e.clientX, e.clientY);
      const result: PickResult | null = anchor ? { anchor, clientX: e.clientX, clientY: e.clientY } : null;
      this.emit('pick', result);
    } else {
      this.emit('backgroundClick', undefined);
    }
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (!this.pickMode || e.buttons) {
      if (e.buttons) this.previewEl.style.display = 'none';
      return;
    }
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (this.previewRaf) return;
    this.previewRaf = requestAnimationFrame(() => {
      this.previewRaf = 0;
      if (!this.lastPointer || !this.pickMode) return;
      const hit = this.raycastNdc(this.pointerToNdc(this.lastPointer.x, this.lastPointer.y));
      if (!hit) {
        this.previewEl.style.display = 'none';
        return;
      }
      const r = this.canvas.getBoundingClientRect();
      const p = hit.point.clone().project(this.camera);
      this.previewEl.style.display = 'block';
      this.previewEl.style.transform = `translate3d(${((p.x + 1) / 2) * r.width}px, ${((1 - p.y) / 2) * r.height}px, 0)`;
    });
  };

  private readonly onPointerLeave = () => {
    this.previewEl.style.display = 'none';
  };

  private handleKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? 0.06 : 7;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        e.shiftKey ? this.panBy(-step, 0) : this.rotateBy(-step, 0);
        break;
      case 'ArrowRight':
        e.shiftKey ? this.panBy(step, 0) : this.rotateBy(step, 0);
        break;
      case 'ArrowUp':
        e.shiftKey ? this.panBy(0, step) : this.rotateBy(0, step);
        break;
      case 'ArrowDown':
        e.shiftKey ? this.panBy(0, -step) : this.rotateBy(0, -step);
        break;
      case '+':
      case '=':
        this.zoomBy(0.85);
        break;
      case '-':
      case '_':
        this.zoomBy(1 / 0.85);
        break;
      case '0':
      case 'Home':
        this.resetView(true);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.emit('contextLost', undefined);
  };

  // ───────────────────────── render loop & markers ─────────────────────────
  resize(width?: number, height?: number): void {
    const w = Math.max(1, Math.floor(width ?? this.container.clientWidth));
    const h = Math.max(1, Math.floor(height ?? this.container.clientHeight));
    if (w === this.width && h === this.height && width === undefined) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.markDirty(true);
  }

  private markDirty(occlusion = false): void {
    this.dirty = true;
    if (occlusion) this.occlusionDirty = true;
  }

  private loop(now: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.flight) {
      const f = this.flight;
      const t = Math.min(1, (now - f.start) / f.duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      this.camera.lookAt(this.controls.target);
      if (t >= 1) this.flight = null;
      this.markDirty(true);
    }
    const moved = this.controls.update();
    if (moved || this.dirty) {
      this.updateKeyLight();
      this.camera.updateMatrixWorld();
      if (this.occlusionDirty && now - this.lastOcclusion > 70) this.updateOcclusionNow(now);
      this.renderer.render(this.scene, this.camera);
      this.updateMarkers();
      this.dirty = false;
    } else if (this.occlusionDirty && now - this.lastOcclusion > 70) {
      this.updateOcclusionNow(now);
      this.updateMarkers();
    }
  }

  private updateOcclusionNow(now = performance.now()): void {
    this.lastOcclusion = now;
    this.occlusionDirty = false;
    if (!this.root) return;
    this.camera.updateMatrixWorld();
    const camPos = this.camera.position;
    const eps = Math.max(1e-5, this.radius * 0.004);
    (this.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    for (const a of this.annotations) {
      const mesh = this.anchorMeshes.get(a.id);
      if (!mesh || !this.effectivelyVisible(mesh)) {
        this.occlusion.delete(a.id);
        continue;
      }
      mesh.updateWorldMatrix(true, false);
      const p = this.tmpV.set(a.anchor.position[0], a.anchor.position[1], a.anchor.position[2]).applyMatrix4(mesh.matrixWorld);
      const dir = p.clone().sub(camPos);
      const dist = dir.length();
      if (dist < 1e-9) {
        this.occlusion.set(a.id, false);
        continue;
      }
      dir.divideScalar(dist);
      this.raycaster.set(camPos, dir);
      this.raycaster.near = 0;
      this.raycaster.far = dist + eps;
      const hits = this.raycaster.intersectObjects(this.pickables, false);
      this.occlusion.set(a.id, !!hits.length && hits[0].distance < dist - eps);
    }
    this.raycaster.far = Infinity;
  }

  private updateMarkers(): void {
    if (!this.root) return;
    const display: DisplayMarker[] = [];
    const states: Record<string, MarkerState> = {};
    const labelFor = this.options.labelFor ?? ((a: Annotation) => a.label);
    this.annotations.forEach((a, i) => {
      const mesh = this.anchorMeshes.get(a.id);
      if (!mesh || !this.effectivelyVisible(mesh)) {
        states[a.id] = 'structure-hidden';
        return;
      }
      mesh.updateWorldMatrix(true, false);
      const p = this.tmpV.set(a.anchor.position[0], a.anchor.position[1], a.anchor.position[2]).applyMatrix4(mesh.matrixWorld);
      const ndc = p.clone().project(this.camera);
      if (ndc.z > 1 || ndc.z < -1 || Math.abs(ndc.x) > 1.03 || Math.abs(ndc.y) > 1.03) {
        states[a.id] = 'offscreen';
        return;
      }
      const occluded = this.occlusion.get(a.id) === true;
      states[a.id] = occluded ? 'occluded' : 'visible';
      if (!this.showMarkers) return;
      const selected = a.id === this.selectedId;
      if (occluded && !selected && !this.showHiddenMarkers) return;
      display.push({
        id: a.id,
        num: i + 1,
        label: labelFor(a, i),
        x: ((ndc.x + 1) / 2) * this.width,
        y: ((1 - ndc.y) / 2) * this.height,
        selected,
        ghost: occluded,
      });
    });
    this.markers.render(display, this.width, this.height);
    const sig = Object.entries(states)
      .map(([k, v]) => k + v)
      .join('|');
    if (sig !== this.markerStateSig) {
      this.markerStateSig = sig;
      this.markerStates = states;
      this.emit('markerStates', states);
    }
  }

  // ───────────────────────────── thumbnails ─────────────────────────────
  /**
   * Renders the current scene from `view` (default: the saved default view) to a JPEG. Works by
   * temporarily resizing the canvas, so no second WebGL context is needed.
   */
  async captureThumbnail(opts: { width?: number; height?: number; view?: CameraView | null; quality?: number } = {}): Promise<Blob> {
    const width = opts.width ?? 640;
    const height = opts.height ?? 480;
    if (!this.root) throw new Error('No model is loaded.');
    const saved = {
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
      up: this.camera.up.clone(),
      fov: this.camera.fov,
      zoom: this.camera.zoom,
      near: this.camera.near,
      far: this.camera.far,
      aspect: this.camera.aspect,
      pr: this.renderer.getPixelRatio(),
      w: this.width,
      h: this.height,
    };
    const view = opts.view ?? this.getEffectiveDefaultView();
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      if (view) {
        const target = new THREE.Vector3(...view.target);
        const pos = new THREE.Vector3(...view.position);
        if (view.aspect > this.camera.aspect + 1e-3) pos.sub(target).multiplyScalar(Math.min(view.aspect / this.camera.aspect, 3)).add(target);
        this.camera.up.set(...view.up);
        this.camera.fov = view.fov;
        this.camera.zoom = view.zoom;
        this.camera.position.copy(pos);
        this.controls.target.copy(target);
        this.camera.lookAt(target);
      }
      this.updateClipping();
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
      this.updateKeyLight();
      this.renderer.render(this.scene, this.camera);
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('2D canvas is not available.');
      if (this.background.type === 'solid') ctx.fillStyle = this.background.color;
      else {
        const g = ctx.createLinearGradient(0, 0, 0, height);
        g.addColorStop(0, this.background.top);
        g.addColorStop(1, this.background.bottom);
        ctx.fillStyle = g;
      }
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(this.canvas, 0, 0, width, height);
      return await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Thumbnail encoding failed.'))), 'image/jpeg', opts.quality ?? 0.86));
    } finally {
      this.renderer.setPixelRatio(saved.pr);
      this.renderer.setSize(saved.w, saved.h, false);
      this.camera.aspect = saved.aspect;
      this.camera.up.copy(saved.up);
      this.camera.fov = saved.fov;
      this.camera.zoom = saved.zoom;
      this.camera.position.copy(saved.pos);
      this.controls.target.copy(saved.target);
      this.camera.near = saved.near;
      this.camera.far = saved.far;
      this.camera.lookAt(saved.target);
      this.camera.updateProjectionMatrix();
      this.markDirty();
    }
  }

  // ───────────────────────────── diagnostics ─────────────────────────────
  /** Compact state snapshot used by automated tests and support diagnostics. */
  debugState() {
    const markerEls = Array.from(this.container.querySelectorAll<HTMLButtonElement>('.av-marker'));
    return {
      camera: this.getCameraView(),
      hiddenKeys: this.getHiddenKeys(),
      isolatedKey: this.isolatedKey,
      markerStates: this.markerStates,
      selectedId: this.selectedId,
      radius: this.radius,
      size: { width: this.width, height: this.height },
      renderer: { geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures },
      markers: markerEls.map((el) => {
        const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
        const r = this.canvas.getBoundingClientRect();
        return { label: el.getAttribute('aria-label'), x: m ? Number(m[1]) + r.left : null, y: m ? Number(m[2]) + r.top : null, selected: el.classList.contains('av-marker--selected'), ghost: el.classList.contains('av-marker--ghost'), cluster: el.classList.contains('av-marker--cluster') };
      }),
      annotationWorld: Object.fromEntries(this.annotations.map((a) => [a.id, this.getAnnotationWorldPosition(a.id)?.toArray() ?? null])),
    };
  }

  /** Screen position (client space) of an annotation, for tests. */
  getAnnotationClientPosition(id: string): { x: number; y: number } | null {
    const p = this.getAnnotationWorldPosition(id);
    if (!p) return null;
    const ndc = p.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((ndc.x + 1) / 2) * r.width, y: r.top + ((1 - ndc.y) / 2) * r.height };
  }

  // ───────────────────────────── disposal ─────────────────────────────
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.previewRaf);
    ViewerCore.instances.delete(this);
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.controls.dispose();
    this.clearModel();
    this.markers.destroy();
    this.previewEl.remove();
    this.envTexture?.dispose();
    this.pmrem?.dispose();
    this.scene.environment = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.listeners.clear();
    this.container.classList.remove('av-viewer', 'av-viewer--picking');
  }
}
