/**
 * Generates the demonstration content shipped with the application.
 *
 * All four models are SCHEMATIC, procedurally generated shapes created by this script (CC0 / public
 * domain). They are deliberately simplified and are NOT anatomically accurate; they exist so the
 * software can be demonstrated without redistributing anyone else's artwork. The descriptive text is
 * illustrative placeholder content, not curriculum material.
 *
 * Run:  npm run demo:generate
 * Output: public/demo/*.glb and public/demo/demo-project.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { anchorFromHit, keyOf, nodeName } from '../src/viewer/meshKeys';
import { DEFAULT_FOV, frameBox } from '../src/viewer/framing';

// GLTFExporter converts blobs with FileReader, which Node does not provide.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  onload: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onload?.();
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
      this.onload?.();
      this.onloadend?.();
    });
  }
}
(globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;

type V3 = [number, number, number];
const OUT = 'public/demo';

const mat = (name: string, color: string, roughness = 0.55, metalness = 0) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  m.name = name;
  return m;
};

function ellipsoid(r: V3, p: V3, rot: V3 = [0, 0, 0], seg = 56): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75));
  g.scale(r[0], r[1], r[2]);
  g.rotateX(rot[0]);
  g.rotateY(rot[1]);
  g.rotateZ(rot[2]);
  g.translate(p[0], p[1], p[2]);
  return g;
}
function cyl(r1: number, r2: number, h: number, p: V3, rot: V3 = [0, 0, 0], seg = 32): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg, 1);
  g.rotateX(rot[0]);
  g.rotateY(rot[1]);
  g.rotateZ(rot[2]);
  g.translate(p[0], p[1], p[2]);
  return g;
}
function tubeGeo(points: V3[], radius: number, segs = 72, radial = 20): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, segs, radius, radial, false);
}
function torus(R: number, r: number, arc: number, p: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(R, r, 16, 48, arc);
  g.scale(...scale);
  g.rotateX(rot[0]);
  g.rotateY(rot[1]);
  g.rotateZ(rot[2]);
  g.translate(p[0], p[1], p[2]);
  return g;
}
const merge = (gs: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(gs.map((x) => (x.index ? x : x)), false);
  if (!g) throw new Error('merge failed');
  return g;
};
function mesh(name: string, g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.name = name;
  return me;
}
function group(name: string, children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  if (children.length) g.add(...children);
  return g;
}

// ───────────────────────────── Heart ─────────────────────────────
function buildHeart(): THREE.Scene {
  const blue = mat('Deoxygenated blood (blue)', '#5d7fc6', 0.5);
  const blue2 = mat('Right ventricle muscle', '#6a88cb', 0.55);
  const red = mat('Oxygenated blood (red)', '#c4474f', 0.5);
  const red2 = mat('Left ventricle muscle', '#b73d46', 0.6);
  const vessel = mat('Artery wall', '#d4665c', 0.45);
  const vein = mat('Vein wall', '#4f6db4', 0.45);
  const chambers = group('Chambers', [
    mesh('Right atrium', ellipsoid([2.5, 2.9, 2.3], [-2.9, 1.3, 0.6], [0, 0, 0.15]), blue),
    mesh('Left atrium', ellipsoid([2.4, 2.1, 2.2], [2.3, 2.6, -1.7], [0.3, 0, 0]), red),
    mesh('Right ventricle', ellipsoid([3.0, 4.2, 2.8], [-1.0, -1.9, 1.9], [0, 0, -0.18]), blue2),
    mesh('Left ventricle', ellipsoid([3.3, 5.2, 3.2], [2.0, -2.5, -0.1], [0, 0, -0.32]), red2),
  ]);
  const aorta = new THREE.CatmullRomCurve3([[1.2, 2.6, 0.2], [0.8, 5.4, 0.2], [0.2, 7.6, -0.6], [-1.4, 8.4, -1.8], [-3.0, 7.2, -2.6], [-3.4, 3.8, -2.8], [-3.4, -1.0, -3.0]].map((p) => new THREE.Vector3(...p)));
  const ptCurve = new THREE.CatmullRomCurve3([[-0.9, 2.4, 1.5], [-0.5, 5.2, 1.0], [0.1, 7.2, 0.0]].map((p) => new THREE.Vector3(...p)));
  const vessels = group('Great vessels', [
    mesh('Aorta', new THREE.TubeGeometry(aorta, 96, 1.05, 24, false), vessel),
    mesh('Pulmonary trunk', new THREE.TubeGeometry(ptCurve, 48, 1.0, 24, false), mat('Pulmonary trunk wall', '#8294d4', 0.45)),
    mesh('Superior vena cava', merge([tubeGeo([[-3.3, 3.3, 0.2], [-3.4, 6.0, 0.0], [-3.4, 9.0, -0.2]], 0.8)]), vein),
    mesh('Inferior vena cava', merge([tubeGeo([[-3.3, -1.2, 0.3], [-3.3, -3.4, 0.0], [-3.2, -5.2, -0.2]], 0.85)]), vein),
    mesh('Right pulmonary artery', merge([tubeGeo([[-0.1, 6.6, 0.3], [-1.5, 7.6, -1.0], [-5.6, 7.4, -1.6]], 0.6)]), mat('Right pulmonary artery wall', '#8294d4', 0.45)),
    mesh('Left pulmonary artery', merge([tubeGeo([[0.1, 6.8, 0.1], [2.2, 7.2, -1.0], [5.6, 6.6, -1.8]], 0.6)]), mat('Left pulmonary artery wall', '#8294d4', 0.45)),
  ]);
  const scene = new THREE.Scene();
  scene.add(chambers, vessels);
  return scene;
}

// ──────────────────────── Respiratory tract ────────────────────────
function buildRespiratory(): THREE.Scene {
  const cartilage = mat('Airway cartilage', '#dfe6ea', 0.35);
  const lung = (n: string, c: string) => mat(n, c, 0.85);
  const rings: THREE.BufferGeometry[] = [cyl(0.85, 0.85, 11.0, [0, 10.5, 0], [0, 0, 0], 40)];
  for (let i = 0; i < 16; i++) rings.push(torus(0.95, 0.16, Math.PI * 2, [0, 5.5 + i * 0.66, 0], [Math.PI / 2, 0, 0]));
  const rb = tubeGeo([[0, 4.8, 0], [-1.6, 3.8, 0.1], [-3.2, 2.2, 0.0], [-4.2, -0.4, 0.0], [-4.4, -4.0, 0.2]], 0.62);
  const lb = tubeGeo([[0, 4.8, 0], [1.9, 3.6, 0.1], [3.6, 1.8, 0.0], [4.4, -0.8, 0.0], [4.4, -4.2, 0.2]], 0.55);
  const larynx = merge([ellipsoid([1.55, 1.7, 1.45], [0, 17.0, 0.1]), cyl(1.25, 1.0, 1.4, [0, 15.7, 0])]);
  const airway = group('Conducting airway', [mesh('Larynx', larynx, mat('Larynx cartilage', '#d3dce2', 0.4)), mesh('Trachea', merge(rings), cartilage), mesh('Right main bronchus', rb, cartilage), mesh('Left main bronchus', lb, cartilage)]);
  const rightLung = group('Right lung', [
    mesh('Right superior lobe', ellipsoid([3.3, 3.6, 3.0], [-5.6, 2.8, 0.2], [0, 0, -0.1]), lung('Right superior lobe tissue', '#e3a0a5')),
    mesh('Right middle lobe', ellipsoid([3.1, 1.8, 3.0], [-5.2, -1.4, 0.8], [0, 0, 0]), lung('Right middle lobe tissue', '#dd949a')),
    mesh('Right inferior lobe', ellipsoid([3.5, 4.4, 3.4], [-5.4, -5.0, -0.8], [0.15, 0, 0]), lung('Right inferior lobe tissue', '#e8adb2')),
  ]);
  const leftLung = group('Left lung', [
    mesh('Left superior lobe', ellipsoid([3.2, 4.4, 3.0], [5.4, 1.8, 0.3], [0, 0, 0.1]), lung('Left superior lobe tissue', '#e3a0a5')),
    mesh('Left inferior lobe', ellipsoid([3.4, 4.6, 3.4], [5.3, -4.8, -0.8], [0.15, 0, 0]), lung('Left inferior lobe tissue', '#e8adb2')),
  ]);
  const scene = new THREE.Scene();
  scene.add(airway, rightLung, leftLung);
  return scene;
}

// ───────────────────────── Vertebral column ─────────────────────────
function vertebraGeometry(r: number, h: number, spine: number, transverse: number): THREE.BufferGeometry {
  const canal = r * 0.55;
  const parts = [
    cyl(r, r * 1.04, h, [0, 0, 0], [0, 0, 0], 40),
    torus(canal + r * 0.28, r * 0.26, Math.PI * 2, [0, h * 0.05, -(r + canal * 0.55)], [Math.PI / 2, 0, 0], [1, 1, 1.15]),
    cyl(r * 0.2, r * 0.1, spine, [0, -spine * 0.22, -(r + canal * 2.05 + spine * 0.4)], [Math.PI / 2 - 0.35, 0, 0], 16),
    cyl(r * 0.17, r * 0.12, transverse, [r + canal + transverse * 0.2, h * 0.05, -(r + canal * 0.9)], [0, 0, Math.PI / 2], 14),
    cyl(r * 0.17, r * 0.12, transverse, [-(r + canal + transverse * 0.2), h * 0.05, -(r + canal * 0.9)], [0, 0, Math.PI / 2], 14),
  ];
  return merge(parts);
}

function buildSpine(): THREE.Scene {
  const bone = mat('Bone', '#e5d8bb', 0.7);
  const disc = mat('Intervertebral disc', '#7ea3c6', 0.6);
  const centre = new THREE.CatmullRomCurve3([[0, 0, 0.4], [0, -9, 2.0], [0, -22, 0.2], [0, -40, -3.4], [0, -50, -0.4], [0, -58, 1.2], [0, -63, 0.4], [0, -71, -3.2]].map((p) => new THREE.Vector3(...p)));
  const total = centre.getLength();
  const names: { n: string; r: number; h: number; spine: number; trans: number; grp: string }[] = [];
  for (let i = 1; i <= 7; i++) names.push({ n: `C${i}`, r: 0.85 + i * 0.03, h: 1.15, spine: 1.0 + (i === 7 ? 1.6 : 0.4), trans: 1.1, grp: 'Cervical vertebrae' });
  for (let i = 1; i <= 12; i++) names.push({ n: `T${i}`, r: 1.05 + i * 0.045, h: 1.7, spine: 2.4, trans: 1.7, grp: 'Thoracic vertebrae' });
  for (let i = 1; i <= 5; i++) names.push({ n: `L${i}`, r: 1.75 + i * 0.07, h: 2.3, spine: 2.0, trans: 1.5, grp: 'Lumbar vertebrae' });
  const gap = 0.55;
  const spanTotal = names.reduce((s, v) => s + v.h + gap, 0);
  const scale = (total * 0.86) / spanTotal;
  const groups: Record<string, THREE.Group> = {};
  const discGeos: THREE.BufferGeometry[] = [];
  let s = 0;
  const place = (g: THREE.BufferGeometry, u: number, extraScale = 1): THREE.BufferGeometry => {
    const p = centre.getPointAt(Math.min(1, u));
    const t = centre.getTangentAt(Math.min(1, u));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), t.clone().multiplyScalar(-1));
    const m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1).multiplyScalar(extraScale));
    g.applyMatrix4(m);
    return g;
  };
  names.forEach((v, idx) => {
    const centreS = s + (v.h * scale) / 2;
    const geo = place(vertebraGeometry(v.r, v.h * scale, v.spine, v.trans), centreS / total);
    (groups[v.grp] ??= group(v.grp, [])).add(mesh(v.n, geo, bone));
    s += v.h * scale;
    if (idx < names.length - 1) {
      const dg = place(cyl(v.r * 0.96, v.r * 0.96, gap * scale * 0.95, [0, 0, 0], [0, 0, 0], 32), (s + (gap * scale) / 2) / total);
      discGeos.push(dg);
      s += gap * scale;
    }
  });
  const sacrumU = (s + 1) / total;
  const sacrumGeo = place(merge([cyl(3.3, 1.6, 8.5, [0, 0, 0], [0, 0, 0], 32), ellipsoid([3.0, 4.0, 1.2], [0, 0, -3.2])]), sacrumU + 4.2 / total);
  const coccyxGeo = place(cyl(1.0, 0.25, 3.2, [0, 0, 0], [0, 0, 0], 16), sacrumU + 9.8 / total);
  const sacral = group('Sacrum and coccyx', [mesh('Sacrum', sacrumGeo, bone), mesh('Coccyx', coccyxGeo, bone)]);
  const scene = new THREE.Scene();
  scene.add(groups['Cervical vertebrae'], groups['Thoracic vertebrae'], groups['Lumbar vertebrae'], sacral, mesh('Intervertebral discs', merge(discGeos), disc));
  return scene;
}

// ───────────────────────────── Knee ─────────────────────────────
function buildKnee(): THREE.Scene {
  const bone = mat('Bone', '#e8dcc2', 0.7);
  const lig = mat('Ligament', '#d9c27a', 0.5);
  const tendon = mat('Tendon', '#e6d8a8', 0.5);
  const cart = mat('Meniscus', '#6fa7b5', 0.55);
  const femur = merge([cyl(1.75, 1.85, 6.5, [0, 11.2, -0.4], [0, 0, 0], 40), cyl(1.9, 3.6, 5.4, [0, 6.3, -0.4], [0, 0, 0], 40), ellipsoid([2.4, 2.5, 2.7], [2.0, 1.4, -0.5]), ellipsoid([2.3, 2.4, 2.6], [-2.0, 1.4, -0.5])]);
  const tibia = merge([cyl(4.3, 3.3, 1.8, [0, -2.6, 0], [0, 0, 0], 48), cyl(2.0, 1.5, 9.5, [0, -8.2, 0], [0, 0, 0], 32), ellipsoid([1.2, 1.5, 1.1], [0, -5.2, 2.0])]);
  tibia.scale(1, 1, 0.85);
  const fibula = merge([cyl(0.55, 0.5, 9.2, [-4.4, -8.9, -1.4], [0, 0, 0], 16), ellipsoid([1.0, 1.0, 0.9], [-4.1, -4.4, -1.4])]);
  const patella = ellipsoid([1.9, 2.2, 0.95], [0, 2.1, 3.4]);
  const medial = torus(2.5, 0.5, Math.PI * 1.55, [2.0, -1.5, -0.3], [Math.PI / 2, 0, 0], [0.95, 1.05, 1.6]);
  medial.rotateY(Math.PI * 0.55);
  const lateral = torus(2.2, 0.5, Math.PI * 1.7, [-2.1, -1.5, -0.3], [Math.PI / 2, 0, 0], [0.95, 1.0, 1.6]);
  lateral.rotateY(Math.PI * 0.6 - Math.PI * 0.2);
  const scene = new THREE.Scene();
  scene.add(
    group('Bones', [mesh('Femur (distal)', femur, bone), mesh('Tibia (proximal)', tibia, bone), mesh('Fibula (proximal)', fibula, bone), mesh('Patella', patella, bone)]),
    group('Menisci', [mesh('Medial meniscus', medial, cart), mesh('Lateral meniscus', lateral, cart)]),
    group('Ligaments and tendons', [
      mesh('Anterior cruciate ligament', tubeGeo([[-0.9, 1.2, -1.0], [-0.3, -0.2, 0.0], [0.3, -1.8, 0.9]], 0.38, 24, 14), lig),
      mesh('Posterior cruciate ligament', tubeGeo([[0.8, 1.2, 0.0], [0.4, -0.4, -1.0], [-0.1, -1.9, -1.9]], 0.42, 24, 14), lig),
      mesh('Medial collateral ligament', tubeGeo([[4.5, 2.4, -0.2], [4.9, -1.0, -0.3], [4.2, -6.4, -0.3]], 0.34, 24, 14), lig),
      mesh('Lateral collateral ligament', tubeGeo([[-4.4, 2.4, -0.5], [-4.9, -1.2, -0.7], [-4.7, -4.6, -1.3]], 0.28, 24, 14), lig),
      mesh('Patellar ligament', tubeGeo([[0, 0.2, 3.5], [0, -2.4, 3.2], [0, -4.8, 2.5]], 0.72, 24, 16), tendon),
      mesh('Quadriceps tendon', tubeGeo([[0, 4.1, 3.5], [0, 7.0, 3.0], [0, 8.6, 2.4]], 0.95, 24, 16), tendon),
    ]),
  );
  return scene;
}

// ─────────────────────── Export + annotation anchoring ───────────────────────
async function exportGlb(scene: THREE.Scene): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(scene, (r) => resolve(r as ArrayBuffer), reject, { binary: true });
  });
}

async function reload(buf: ArrayBuffer): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buf, '', (g) => resolve(g.scene), reject);
  });
}

interface AnnSpec {
  mesh: string;
  aim?: V3;
  from: V3;
  label: string;
  category: string;
  description: string;
  link?: { url: string; title: string };
  required?: boolean;
}

interface ModelSpec {
  slug: string;
  title: string;
  description: string;
  regions: string[];
  systems: string[];
  build: () => THREE.Scene;
  viewDir: V3;
  annotations: AnnSpec[];
}

const NOTE = 'A simplified, schematic shape generated by this project (CC0). It is not anatomically accurate, and the text is illustrative placeholder content for demonstrating the software. Replace it with your own models and teaching material.';

const specs: ModelSpec[] = [
  {
    slug: 'schematic-heart',
    title: 'Heart (schematic demonstration)',
    description: `${NOTE}\n\nUse the structure list to hide the chambers and see how the great vessels connect, or switch on self-study mode to test yourself on the numbered markers.`,
    regions: ['region-thorax'],
    systems: ['system-cardiovascular'],
    build: buildHeart,
    viewDir: [0.18, 0.12, 1],
    annotations: [
      { mesh: 'Right atrium', aim: [-3.4, 1.8, 0.8], from: [-1, 0.2, 1], label: 'Right atrium', category: 'Chamber', description: 'Receives deoxygenated blood from the **superior** and **inferior venae cavae**.\n\n- Blood passes through the tricuspid valve into the right ventricle.\n- Placeholder text for demonstration.', link: { url: 'https://en.wikipedia.org/wiki/Atrium_(heart)', title: 'Atrium (heart) – Wikipedia' } },
      { mesh: 'Right ventricle', aim: [-1.2, -2.2, 4.4], from: [0, 0, 1], label: 'Right ventricle', category: 'Chamber', description: 'Pumps blood into the **pulmonary trunk** and on to the lungs.\nIts wall is thinner than that of the left ventricle.' },
      { mesh: 'Left ventricle', aim: [3.4, -3.4, 1.5], from: [1, -0.1, 1], label: 'Left ventricle', category: 'Chamber', description: 'The thickest-walled chamber. It pumps oxygenated blood through the aortic valve into the **aorta**.', link: { url: 'https://en.wikipedia.org/wiki/Ventricle_(heart)', title: 'Ventricle (heart) – Wikipedia' } },
      { mesh: 'Left atrium', aim: [2.6, 3.6, -2.4], from: [0.5, 1, -0.4], label: 'Left atrium', category: 'Chamber', description: 'Receives oxygenated blood from the pulmonary veins. Lies posteriorly, so it is best seen from behind or above.' },
      { mesh: 'Aorta', aim: [0.2, 7.6, -0.6], from: [0, 1, 0.3], label: 'Aortic arch', category: 'Great vessel', description: 'The arch of the aorta curves backwards and to the left over the pulmonary trunk before descending.' },
      { mesh: 'Pulmonary trunk', aim: [-0.4, 5.0, 1.0], from: [0, 0.3, 1], label: 'Pulmonary trunk', category: 'Great vessel', description: 'Carries deoxygenated blood from the right ventricle and divides into the right and left pulmonary arteries.' },
      { mesh: 'Superior vena cava', aim: [-3.4, 7.0, -0.1], from: [-1, 0, 1], label: 'Superior vena cava', category: 'Great vessel', description: 'Returns blood from the head, neck and upper limbs to the right atrium.' },
    ],
  },
  {
    slug: 'schematic-respiratory-tract',
    title: 'Airway and lungs (schematic demonstration)',
    description: `${NOTE}\n\nThe bronchi sit *inside* the lobes, so some markers are hidden behind lung tissue — hide the lungs in the structure list to reveal them.`,
    regions: ['region-thorax', 'region-head-neck'],
    systems: ['system-respiratory'],
    build: buildRespiratory,
    viewDir: [0.1, 0.1, 1],
    annotations: [
      { mesh: 'Larynx', aim: [0, 17.0, 1.55], from: [0, 0, 1], label: 'Larynx', category: 'Airway', description: 'The voice box, at the upper end of the trachea.' },
      { mesh: 'Trachea', aim: [0, 10.5, 0.9], from: [0, 0, 1], label: 'Trachea', category: 'Airway', description: 'A flexible airway held open by C-shaped rings of cartilage.', link: { url: 'https://en.wikipedia.org/wiki/Trachea', title: 'Trachea – Wikipedia' } },
      { mesh: 'Right main bronchus', aim: [-3.2, 2.2, 0.0], from: [0, 0.2, 1], label: 'Right main bronchus', category: 'Airway', description: 'Shorter, wider and more vertical than the left main bronchus. Hidden behind lung tissue from the front.' },
      { mesh: 'Left main bronchus', aim: [3.6, 1.8, 0.0], from: [0, 0.2, 1], label: 'Left main bronchus', category: 'Airway', description: 'Longer and more horizontal than the right main bronchus.' },
      { mesh: 'Right superior lobe', aim: [-6.2, 4.2, 1.5], from: [-0.3, 0.2, 1], label: 'Right superior lobe', category: 'Lobe', description: 'The right lung has **three** lobes: superior, middle and inferior.' },
      { mesh: 'Right middle lobe', aim: [-5.4, -1.4, 3.8], from: [0, 0, 1], label: 'Right middle lobe', category: 'Lobe', description: 'Present only in the right lung.' },
      { mesh: 'Left superior lobe', aim: [5.6, 2.4, 3.1], from: [0.3, 0.1, 1], label: 'Left superior lobe', category: 'Lobe', description: 'The left lung has **two** lobes. The cardiac notch is not modelled in this schematic.' },
    ],
  },
  {
    slug: 'schematic-vertebral-column',
    title: 'Vertebral column (schematic demonstration)',
    description: `${NOTE}\n\nThirty meshes grouped by region make this a good test for the structure list: try isolating a single vertebra.`,
    regions: ['region-back', 'region-head-neck'],
    systems: ['system-skeletal'],
    build: buildSpine,
    viewDir: [1, 0.05, 0.12],
    annotations: [
      { mesh: 'C1', from: [0, 0.2, 1], label: 'C1 (atlas)', category: 'Cervical', description: 'Supports the skull. In a real vertebra it has no body; this schematic does not show that.' },
      { mesh: 'C7', aim: undefined, from: [0, 0, -1], label: 'C7 (vertebra prominens)', category: 'Cervical', description: 'Has a long spinous process that can be felt at the base of the neck.' },
      { mesh: 'T12', from: [1, 0, 0], label: 'T12', category: 'Thoracic', description: 'The last thoracic vertebra; it marks the transition to the lumbar spine.' },
      { mesh: 'L4', from: [1, 0, 0.1], label: 'L4', category: 'Lumbar', description: 'Lumbar vertebrae have large bodies to bear the weight of the upper body.', link: { url: 'https://en.wikipedia.org/wiki/Lumbar_vertebrae', title: 'Lumbar vertebrae – Wikipedia' } },
      { mesh: 'Sacrum', from: [1, 0, 0.2], label: 'Sacrum', category: 'Sacral', description: 'Five fused sacral vertebrae forming the back of the pelvis (represented here by one wedge).' },
      { mesh: 'Intervertebral discs', from: [1, 0, 0.3], label: 'Intervertebral discs', category: 'Soft tissue', description: 'Fibrocartilaginous discs that separate adjacent vertebral bodies and absorb load.' },
    ],
  },
  {
    slug: 'schematic-knee-joint',
    title: 'Knee joint (schematic demonstration)',
    description: `${NOTE}\n\nFrom the front the cruciate ligaments are hidden. Rotate the model, or use the list to jump to a marker and the view will turn to face it.`,
    regions: ['region-lower-limb'],
    systems: ['system-skeletal', 'system-muscular'],
    build: buildKnee,
    viewDir: [0.75, 0.1, 1],
    annotations: [
      { mesh: 'Patella', aim: [0, 2.1, 4.35], from: [0, 0, 1], label: 'Patella', category: 'Bone', description: 'The kneecap: a sesamoid bone within the quadriceps tendon.', link: { url: 'https://en.wikipedia.org/wiki/Patella', title: 'Patella – Wikipedia' } },
      { mesh: 'Femur (distal)', aim: [2.4, 1.8, 1.8], from: [1, 0.2, 0.4], label: 'Medial femoral condyle', category: 'Bone', description: 'The distal end of the femur articulates with the tibia.' },
      { mesh: 'Tibia (proximal)', aim: [3.4, -2.6, 0.0], from: [1, 0, 0.3], label: 'Tibial plateau', category: 'Bone', description: 'The flat upper surface of the tibia that bears the weight transmitted from the femur.' },
      { mesh: 'Medial meniscus', from: [1, 0.3, 0.2], label: 'Medial meniscus', category: 'Cartilage', description: 'A C-shaped fibrocartilage pad that deepens the tibial surface and absorbs shock.' },
      { mesh: 'Lateral meniscus', from: [-1, 0.3, 0.2], label: 'Lateral meniscus', category: 'Cartilage', description: 'More circular than the medial meniscus.' },
      { mesh: 'Anterior cruciate ligament', from: [-0.4, 0.2, -1], label: 'Anterior cruciate ligament (ACL)', category: 'Ligament', description: 'Prevents the tibia sliding forwards on the femur. Hidden from the front by other structures.' },
      { mesh: 'Patellar ligament', aim: [0, -2.4, 4.0], from: [0, 0, 1], label: 'Patellar ligament', category: 'Ligament', description: 'Connects the patella to the tibial tuberosity.' },
    ],
  },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const project: unknown[] = [];
  for (const spec of specs) {
    const scene = spec.build();
    scene.updateMatrixWorld(true);
    const glb = await exportGlb(scene);
    writeFileSync(`${OUT}/${spec.slug}.glb`, Buffer.from(glb));
    const root = await reload(glb);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const raycaster = new THREE.Raycaster();
    const annotations = spec.annotations.map((a, i) => {
      let target: THREE.Mesh | null = null;
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && nodeName(o) === a.mesh) target = o as THREE.Mesh;
      });
      if (!target) throw new Error(`${spec.slug}: mesh not found: ${a.mesh}`);
      const tm = target as THREE.Mesh;
      const aim = a.aim ? new THREE.Vector3(...a.aim) : new THREE.Box3().setFromObject(tm).getCenter(new THREE.Vector3());
      const dir = new THREE.Vector3(...a.from).normalize();
      raycaster.set(aim.clone().addScaledVector(dir, 400), dir.clone().negate());
      raycaster.near = 0;
      raycaster.far = 1000;
      const hits = raycaster.intersectObject(tm, false);
      if (!hits.length) throw new Error(`${spec.slug}: no hit for annotation "${a.label}"`);
      // Choose the hit closest to the aim point (the aim lies inside/on the mesh).
      hits.sort((h1, h2) => h1.point.distanceTo(aim) - h2.point.distanceTo(aim));
      const anchor = anchorFromHit(root, hits[0])!;
      return {
        id: `demo-${spec.slug}-a${i + 1}`,
        label: a.label,
        description: a.description,
        category: a.category,
        link: a.link ?? null,
        required: a.required ?? true,
        anchor,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
    });
    const camera = frameBox(box, new THREE.Vector3(...spec.viewDir), DEFAULT_FOV, 4 / 3);
    let tris = 0;
    let verts = 0;
    let meshes = 0;
    const mats = new Set<THREE.Material>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      mats.add(m.material as THREE.Material);
      const pos = m.geometry.getAttribute('position');
      verts += pos.count;
      tris += m.geometry.index ? m.geometry.index.count / 3 : pos.count / 3;
    });
    const size = box.getSize(new THREE.Vector3());
    // Sanity: keys must round-trip.
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && keyOf(root, o) === null) throw new Error('key failure');
    });
    project.push({
      slug: spec.slug,
      file: `${spec.slug}.glb`,
      title: spec.title,
      description: spec.description,
      credit: 'Procedurally generated by this project. CC0 1.0 (public domain dedication). Schematic demonstration model, not anatomically accurate.',
      regionIds: spec.regions,
      systemIds: spec.systems,
      stats: { totalBytes: glb.byteLength, triangles: Math.round(tris), vertices: verts, meshCount: meshes, materialCount: mats.size, textureCount: 0, boundsSize: size.toArray(), extensionsUsed: [] },
      camera,
      annotations,
    });
    console.log(`${spec.slug}: ${(glb.byteLength / 1024).toFixed(0)} KB, ${meshes} meshes, ${Math.round(tris)} tris, ${annotations.length} annotations`);
  }
  writeFileSync(`${OUT}/demo-project.json`, JSON.stringify({ generatedBy: 'scripts/generate-demo-models.ts', licence: 'CC0 1.0', models: project }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
