import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface FlameState {
  color: string;
  radius: number;
  baseRadius: number;
  soot: number;
  droplet: number;
  o2Share: number;
  density: number;
  intensity: number;
}

const R = 1.7;
const LEN = 6.4;
const FLOOR = -1.05;
const PARTICLES = 520;
const GAP_START = Math.PI * 0.36;
const GAP_LEN = Math.PI * 1.28;
const CENTER = new THREE.Vector3(0, 0.15, 0);

const rnd = (i: number, salt: number) => {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

const parseRgb = (css: string, into: THREE.Color) => {
  const n = css.match(/[\d.]+/g);
  if (n && n.length >= 3) into.setRGB(+n[0] / 255, +n[1] / 255, +n[2] / 255, THREE.SRGBColorSpace);
  return into;
};

const flameMaterial = (color: THREE.Color) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uSoot: { value: 0.2 }, uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vPos; varying vec3 vCam;
      void main() {
        vPos = position;
        vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uSoot; uniform float uTime;
      varying vec3 vPos; varying vec3 vCam;
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1); p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float noise(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
          mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
          f.z);
      }
      float fbm(vec3 p) {
        float a = 0.5; float s = 0.0;
        for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.02 + vec3(7.1); a *= 0.5; }
        return s;
      }
      void main() {
        vec3 ro = vCam;
        vec3 rd = normalize(vPos - vCam);
        float b = dot(ro, rd);
        float h = b * b - (dot(ro, ro) - 1.0);
        if (h < 0.0) discard;
        h = sqrt(h);
        float t0 = max(-b - h, 0.0);
        float t1 = -b + h;
        const int N = 30;
        float dt = (t1 - t0) / float(N);
        float jitter = hash(vec3(gl_FragCoord.xy, fract(uTime) * 10.0));
        vec3 tint = uColor / max(max(uColor.r, max(uColor.g, uColor.b)), 0.001);
        vec3 col = vec3(0.0);
        for (int i = 0; i < N; i++) {
          vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
          float r = length(p);
          float n = fbm(p * 2.6 + vec3(0.0, 0.0, uTime * 0.35));
          float w = fbm(p * 5.5 - vec3(uTime * 0.6, 0.0, uTime * 0.3));
          float rr = r + (n - 0.5) * 0.17;
          float sheet = exp(-pow((rr - 0.78) / 0.05, 2.0));
          float veil = exp(-pow((rr - 0.86) / 0.09, 2.0)) * 0.22;
          float fill = smoothstep(0.8, 0.15, r) * 0.05;
          float soot = uSoot * exp(-pow((rr - 0.47) / 0.085, 2.0)) * (0.15 + 2.2 * w * w);
          float core = exp(-r * r / 0.018);
          col += (tint * (sheet * 2.1 + veil + fill)
            + vec3(1.0, 0.5, 0.12) * soot * 0.75
            + vec3(1.0, 0.8, 0.55) * core * 0.45) * dt;
        }
        col += vec3(dot(max(col - 1.0, 0.0), vec3(0.2)));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.35)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.08)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const EMBERS = 90;

function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, edges = true) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.2 }));
  g.add(mesh);
  if (edges) {
    const e = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }),
    );
    g.add(e);
  }
  g.position.set(x, y, z);
  return g;
}

function screen(w: number, h: number, x: number, y: number, z: number, color = 0x4f8fd6) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }),
  );
  m.position.set(x, y, z);
  return m;
}

function props(id: string): THREE.Group {
  const g = new THREE.Group();
  const wall = -1.1;
  const rack = (x: number) => {
    g.add(box(0.9, 1.7, 0.5, 0x2a2f36, x, FLOOR + 0.85, wall));
    for (let i = 0; i < 3; i++) g.add(box(0.78, 0.04, 0.46, 0x3a414b, x, FLOOR + 0.35 + i * 0.5, wall + 0.03, false));
  };
  switch (id) {
    case "crew":
      g.add(box(1.6, 0.35, 0.8, 0x2b3240, -2.0, FLOOR + 0.2, wall + 0.2));
      g.add(box(1.6, 0.35, 0.8, 0x2b3240, -2.0, FLOOR + 1.0, wall + 0.2));
      g.add(box(1.4, 0.1, 0.7, 0x5b6b86, -2.0, FLOOR + 0.42, wall + 0.2, false));
      g.add(box(1.4, 0.1, 0.7, 0x5b6b86, -2.0, FLOOR + 1.22, wall + 0.2, false));
      rack(2.1);
      g.add(screen(0.5, 0.3, 2.1, FLOOR + 1.4, wall + 0.26));
      break;
    case "lab":
      rack(-2.3);
      rack(-1.3);
      g.add(screen(0.6, 0.35, -1.3, FLOOR + 1.35, wall + 0.26));
      g.add(box(1.4, 0.08, 0.7, 0x39424e, 2.0, FLOOR + 0.8, wall + 0.25));
      g.add(box(0.3, 0.4, 0.3, 0x56708f, 1.7, FLOOR + 1.04, wall + 0.25));
      g.add(box(0.2, 0.25, 0.2, 0x8ba3c4, 2.2, FLOOR + 0.97, wall + 0.25));
      rack(2.6);
      break;
    case "galley":
      g.add(box(1.6, 0.08, 0.8, 0x3a3f46, -1.9, FLOOR + 0.85, wall + 0.25));
      g.add(box(1.4, 0.8, 0.7, 0x2a2e33, -1.9, FLOOR + 0.42, wall + 0.25));
      g.add(box(0.9, 0.6, 0.5, 0x434b55, 2.0, FLOOR + 0.3, wall + 0.1));
      g.add(screen(0.45, 0.3, 2.0, FLOOR + 0.35, wall + 0.36, 0xd69a4a));
      rack(2.6);
      break;
    case "eva": {
      g.add(box(1.4, 1.6, 0.25, 0x2a2f36, -2.1, FLOOR + 0.95, wall - 0.05));
      const hatch = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.06, 12, 40),
        new THREE.MeshStandardMaterial({ color: 0x8a96a8, metalness: 0.6, roughness: 0.35 }),
      );
      hatch.position.set(-2.1, FLOOR + 0.95, wall + 0.1);
      g.add(hatch);
      const suit = new THREE.Group();
      const white = new THREE.MeshStandardMaterial({ color: 0xd7dbe2, roughness: 0.6 });
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 6, 16), white);
      torso.position.y = 0.95;
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), white);
      helmet.position.y = 1.55;
      const visor = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 24, 16, 0, Math.PI, 0, Math.PI * 0.6),
        new THREE.MeshStandardMaterial({ color: 0xc89a3a, metalness: 0.9, roughness: 0.15 }),
      );
      visor.position.set(0, 1.57, 0.07);
      suit.add(torso, helmet, visor);
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.45, 4, 10), white);
        arm.position.set(s * 0.38, 0.95, 0);
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.45, 4, 10), white);
        leg.position.set(s * 0.13, 0.35, 0);
        suit.add(arm, leg);
      }
      suit.position.set(2.0, FLOOR, wall + 0.35);
      g.add(suit);
      break;
    }
    case "storage":
      for (let i = 0; i < 6; i++) {
        const x = -2.6 + (i % 3) * 0.6;
        const y = FLOOR + 0.25 + Math.floor(i / 3) * 0.5;
        g.add(box(0.52, 0.45, 0.5, i % 2 ? 0x3b3428 : 0x2e3540, x, y, wall + 0.15));
      }
      rack(1.8);
      rack(2.7);
      break;
    case "greenhouse": {
      const leaf = new THREE.MeshStandardMaterial({ color: 0x4f9a5a, roughness: 0.8 });
      for (const x of [-2.2, 2.2]) {
        g.add(box(1.5, 0.3, 0.6, 0x2c2f2a, x, FLOOR + 0.15, wall + 0.2));
        for (let i = 0; i < 5; i++) {
          const p = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.35 + rnd(i, x) * 0.3, 7), leaf);
          p.position.set(x - 0.55 + i * 0.27, FLOOR + 0.5, wall + 0.2);
          g.add(p);
        }
        const lamp = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, 0.05, 0.4),
          new THREE.MeshBasicMaterial({ color: 0xd88aff }),
        );
        lamp.position.set(x, FLOOR + 1.6, wall + 0.2);
        g.add(lamp);
      }
      break;
    }
  }
  return g;
}

function astronaut() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x9fb0c8, roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 6, 12), m);
  body.position.y = 0.62;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), m);
  head.position.y = 1.04;
  g.add(body, head);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.36, 4, 8), m);
    arm.position.set(s * 0.22, 0.66, 0.05);
    arm.rotation.z = s * 0.35;
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.4, 4, 8), m);
    leg.position.set(s * 0.08, 0.2, 0);
    g.add(arm, leg);
  }
  return g;
}

export function Room3D({ moduleId, flame, materials, fallback }: {
  moduleId: string;
  fallback: string;
  flame: FlameState;
  materials: { label: string; kept: number; color: string }[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef(flame);
  state.current = flame;
  const [failed, setFailed] = useState(false);
  const api = useRef<{ setProps: (id: string) => void; setMaterials: (m: typeof materials) => void } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0d12, 9, 18);
    const camera = new THREE.PerspectiveCamera(38, 2, 0.1, 60);
    camera.position.set(2.6, 1.6, 6.6);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(CENTER);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3.2;
    controls.maxDistance = 11;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.75;
    controls.autoRotate = !reduce;
    controls.autoRotateSpeed = 0.45;
    let idle: ReturnType<typeof setTimeout>;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      clearTimeout(idle);
    });
    controls.addEventListener("end", () => {
      clearTimeout(idle);
      if (!reduce) idle = setTimeout(() => { controls.autoRotate = true; }, 4000);
    });

    scene.add(new THREE.AmbientLight(0x8fa4c4, 0.35));
    const key = new THREE.DirectionalLight(0xcfe0ff, 0.7);
    key.position.set(3, 5, 4);
    scene.add(key);
    for (const x of [-1.8, 1.8]) {
      const strip = new THREE.PointLight(0xdfe8ff, 2.2, 5, 1.6);
      strip.position.set(x, 1.35, 0);
      scene.add(strip);
    }

    const shell = new THREE.Group();
    shell.rotation.z = Math.PI / 2;
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x1b2028, roughness: 0.85, metalness: 0.25, side: THREE.BackSide,
    });
    const hull = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, LEN, 64, 1, true, GAP_START, GAP_LEN),
      hullMat,
    );
    shell.add(hull);
    const outer = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.06, R + 0.06, LEN, 64, 1, true, GAP_START, GAP_LEN),
      new THREE.MeshStandardMaterial({ color: 0x3a414c, roughness: 0.6, metalness: 0.5, side: THREE.FrontSide }),
    );
    shell.add(outer);
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x6b7686, metalness: 0.7, roughness: 0.35 });
    for (let i = 0; i <= 8; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(R + 0.02, 0.035, 8, 64, GAP_LEN), ribMat);
      rib.rotation.z = Math.PI / 2 + GAP_START;
      const ring = new THREE.Group();
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -LEN / 2 + (i * LEN) / 8;
      ring.add(rib);
      shell.add(ring);
    }
    scene.add(shell);

    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.RingGeometry(0.62, R + 0.06, 64),
        new THREE.MeshStandardMaterial({ color: 0x252b34, roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide }),
      );
      cap.rotation.y = Math.PI / 2;
      cap.position.x = (s * LEN) / 2;
      scene.add(cap);
      const hatch = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.07, 12, 48),
        new THREE.MeshStandardMaterial({ color: 0x9aa6b8, metalness: 0.75, roughness: 0.3 }),
      );
      hatch.rotation.y = Math.PI / 2;
      hatch.position.x = (s * LEN) / 2;
      scene.add(hatch);
      const door = new THREE.Mesh(
        new THREE.CircleGeometry(0.6, 48),
        new THREE.MeshStandardMaterial({ color: 0x151a21, roughness: 0.6, side: THREE.DoubleSide }),
      );
      door.rotation.y = Math.PI / 2;
      door.position.x = (s * LEN) / 2 + s * 0.01;
      scene.add(door);
    }

    const floor = box(LEN - 0.1, 0.06, 2.5, 0x232a33, 0, FLOOR - 0.03, 0);
    scene.add(floor);
    const grid = new THREE.GridHelper(LEN - 0.2, 24, 0x3d4756, 0x2a313c);
    grid.scale.z = 2.4 / (LEN - 0.2);
    grid.position.y = FLOOR + 0.002;
    scene.add(grid);
    for (const z of [-0.95, 0.95]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, LEN - 0.6, 8), ribMat);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, 1.25, z);
      scene.add(rail);
    }
    for (const x of [-1.8, 1.8]) {
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.04, 0.25),
        new THREE.MeshBasicMaterial({ color: 0xe8efff }),
      );
      lamp.position.set(x, 1.52, 0);
      scene.add(lamp);
    }

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -R - 0.55;
    scene.add(ground);
    for (const s of [-1, 1]) {
      for (const x of [-2.2, 2.2]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.7, 8), ribMat);
        leg.position.set(x, -R - 0.2, s * 0.9);
        leg.rotation.x = s * 0.25;
        scene.add(leg);
      }
    }

    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      const th = rnd(i, 1) * Math.PI * 2;
      const ph = Math.acos(rnd(i, 2) * 1.6 - 0.6);
      const d = 26 + rnd(i, 3) * 8;
      starPos.set([d * Math.sin(ph) * Math.cos(th), d * Math.cos(ph), d * Math.sin(ph) * Math.sin(th)], i * 3);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.7, fog: false }),
    );
    scene.add(stars);

    const crew = astronaut();
    crew.position.set(-2.55, FLOOR, 0.55);
    crew.rotation.y = 0.6;
    scene.add(crew);

    let propGroup = props(moduleId);
    scene.add(propGroup);

    const matGroup = new THREE.Group();
    scene.add(matGroup);
    const setMaterials = (list: typeof materials) => {
      matGroup.clear();
      list.forEach((m, i) => {
        const x = (i - (list.length - 1) / 2) * 0.8;
        const panel = box(0.6, 0.7, 0.04, 0x3a3328, x, 0.95, -1.3);
        matGroup.add(panel);
        const bar = new THREE.Mesh(
          new THREE.PlaneGeometry(0.54 * Math.max(m.kept, 0.02), 0.05),
          new THREE.MeshBasicMaterial({ color: parseRgb(m.color, new THREE.Color()) }),
        );
        bar.position.set(x - 0.27 + (0.54 * Math.max(m.kept, 0.02)) / 2, 0.65, -1.27);
        matGroup.add(bar);
      });
    };

    const flameColor = parseRgb(state.current.color, new THREE.Color());
    const volume = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), flameMaterial(flameColor));
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(), color: flameColor, transparent: true, opacity: 0.4,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    const emberGeo = new THREE.BufferGeometry();
    const emberPos = new Float32Array(EMBERS * 3);
    const emberCol = new Float32Array(EMBERS * 3);
    const emberSeed = Array.from({ length: EMBERS }, (_, i) => {
      const th = rnd(i, 21) * Math.PI * 2;
      const z = rnd(i, 22) * 2 - 1;
      const q = Math.sqrt(1 - z * z);
      return { x: q * Math.cos(th), y: q * Math.sin(th), z, sp: 0.12 + rnd(i, 23) * 0.2, ph: rnd(i, 24), tw: rnd(i, 25) * 6 };
    });
    emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3));
    emberGeo.setAttribute("color", new THREE.BufferAttribute(emberCol, 3));
    const embers = new THREE.Points(
      emberGeo,
      new THREE.PointsMaterial({
        size: 0.03, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    const droplet = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.15, metalness: 0.3, emissive: 0x2a1404 }),
    );
    const ghostPts = Array.from({ length: 97 }, (_, i) => {
      const a = (i / 96) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    });
    const ghost = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ghostPts),
      new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, dashSize: 0.06, gapSize: 0.08 }),
    );
    ghost.computeLineDistances();
    const flameLight = new THREE.PointLight(flameColor, 3, 6, 1.4);
    const flame = new THREE.Group();
    flame.add(droplet, halo, volume, embers, ghost, flameLight);
    flame.position.copy(CENTER);
    scene.add(flame);

    const pGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(PARTICLES * 3);
    const col = new Float32Array(PARTICLES * 3);
    const seed = Array.from({ length: PARTICLES }, (_, i) => ({
      x: (rnd(i, 1) - 0.5) * (LEN - 0.6),
      y: FLOOR + 0.15 + rnd(i, 2) * 2.4,
      z: (rnd(i, 3) - 0.5) * 2.2,
      ph: rnd(i, 4) * Math.PI * 2,
      sp: 0.3 + rnd(i, 5) * 0.6,
      kind: rnd(i, 6),
      fall: rnd(i, 7),
    }));
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    scene.add(particles);
    const o2c = new THREE.Color(0x7fb2ff);
    const n2c = new THREE.Color(0x56606e);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const scale = 0.022;
    let raf = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      const t = clock.getElapsedTime();
      const s = state.current;
      parseRgb(s.color, flameColor);
      const flick = reduce ? 1 : 1 + Math.sin(t * 7.3) * 0.012 + Math.sin(t * 13.1) * 0.008 + Math.sin(t * 2.1) * 0.01;
      const rad = s.radius * scale * 1.32 * flick;
      volume.scale.setScalar(rad / 0.78);
      const vm = volume.material as THREE.ShaderMaterial;
      vm.uniforms.uTime.value = reduce ? 0 : t;
      vm.uniforms.uSoot.value = s.soot;
      halo.scale.setScalar(rad * 5.2);
      const sootR = (rad / 0.78) * 0.47;
      for (let i = 0; i < EMBERS; i++) {
        const e = emberSeed[i];
        const k = i * 3;
        const life = reduce ? e.ph : (t * e.sp + e.ph) % 1;
        const d = sootR + (rad * 1.9 - sootR) * life;
        const sw = Math.sin(t * 1.3 + e.tw) * 0.04 * life;
        emberPos[k] = e.x * d + sw;
        emberPos[k + 1] = e.y * d + sw * 0.6;
        emberPos[k + 2] = e.z * d - sw;
        const glow = i < EMBERS * (0.25 + s.soot * 0.75) ? Math.pow(1 - life, 1.6) * (0.35 + s.soot) : 0;
        emberCol[k] = glow; emberCol[k + 1] = glow * 0.55; emberCol[k + 2] = glow * 0.15;
      }
      emberGeo.attributes.position.needsUpdate = true;
      emberGeo.attributes.color.needsUpdate = true;
      droplet.scale.setScalar(s.droplet * 0.035);
      ghost.scale.setScalar(s.baseRadius * scale * 1.32);
      ghost.quaternion.copy(camera.quaternion);
      flameLight.intensity = 2 + s.intensity * 4 * flick;

      const shown = Math.round(PARTICLES * s.density);
      for (let i = 0; i < PARTICLES; i++) {
        const p = seed[i];
        const k = i * 3;
        if (i >= shown) {
          pos[k] = pos[k + 1] = pos[k + 2] = 9999;
          continue;
        }
        const isO2 = p.kind < s.o2Share;
        let x = p.x + Math.sin(t * p.sp + p.ph) * 0.12;
        let y = p.y + Math.cos(t * p.sp * 0.8 + p.ph) * 0.1;
        let z = p.z + Math.sin(t * p.sp * 0.6 + p.ph * 2) * 0.1;
        if (isO2 && !reduce) {
          const cyc = (t * 0.08 * p.sp + p.fall) % 1;
          const pull = cyc * cyc * 0.85;
          x += (CENTER.x - x) * pull;
          y += (CENTER.y - y) * pull;
          z += (CENTER.z - z) * pull;
          const d = Math.hypot(x - CENTER.x, y - CENTER.y, z - CENTER.z);
          if (d < rad * 1.05) { x = y = z = 9999; }
        }
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
        const c = isO2 ? o2c : n2c;
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;

      crew.position.y = FLOOR + (reduce ? 0 : Math.sin(t * 0.9) * 0.03);
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    api.current = {
      setProps: (id) => {
        scene.remove(propGroup);
        propGroup = props(id);
        scene.add(propGroup);
      },
      setMaterials,
    };

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(idle);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { api.current?.setProps(moduleId); }, [moduleId]);
  const matKey = JSON.stringify(materials);
  useEffect(() => { api.current?.setMaterials(materials); }, [matKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <div className="room-3d-canvas room-3d-off">{fallback}</div>;
  return <div ref={host} className="room-3d-canvas" />;
}
