// ── 3D render layer for Finger Runner ────────────────────────────────────
// Pure rendering: reads the existing (unmodified) physics/game state each
// frame via `stateRef` and imperatively positions Three.js objects. No
// gameplay logic lives here — Game.tsx still owns physics, spawning,
// collision, scoring, and persistence exactly as before.
import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import {
  FINGER_CENTER_X, LANE_X, LANE_OFFSET, worldZ, worldY, roadYOld, THEME_COLORS,
  OBSTACLE_COLORS, OBSTACLE_KIND, HAT_COLORS, POWERUP_COLORS,
  CHROME_ACCENT, OBSTACLE_GLOW, OBSTACLE_METAL, OBSTACLE_WOBBLE, BLOOM_CONFIG,
  ROAD_SURFACE_OFFSET, FINGER_TIP_OFFSET, HIDE_Z, BARRIER_GAP,
  POOL_OBSTACLES, POOL_COINS, POOL_PARTICLES, POOL_POWERUPS,
  POOL_PLATFORMS, POOL_ROPES, POOL_PUDDLES,
  type GameSceneState, type Theme3D, type HatId,
} from "./coords";

type SaberInfo = { color: string; glow: string; reach: number };
// Per-character runner-body skin tint. Maps onto the 4 hardcoded runner
// colors (back-of-hand, finger segment, knuckle joint, nail). See the
// shared CHARACTERS table for the per-character values.
type SkinInfo = { backHand: string; finger: string; knuckle: string; nail: string };

interface Scene3DProps {
  stateRef: React.MutableRefObject<GameSceneState>;
  sizeRef: React.MutableRefObject<{ width: number; height: number }>;
  theme: Theme3D;
  hat: HatId;
  saber: SaberInfo;
  skin: SkinInfo;
  /** Character's saber-glow hex — used to tint the 3D sky, fog, and rim light
   *  so each runner feels like they own a different world. */
  accent: string;
}

// These match Game.tsx's hard spawn caps (see coords.ts POOL_* constants) —
// Game.tsx never lets its state arrays grow past these sizes, so every live
// entity always has a render slot here.
const N_OBSTACLES = POOL_OBSTACLES;
const N_COINS = POOL_COINS;
const N_PARTICLES = POOL_PARTICLES;
const N_POWERUPS = POOL_POWERUPS;
const N_PLATFORMS = POOL_PLATFORMS;
const N_ROPES = POOL_ROPES;
const N_PUDDLES = POOL_PUDDLES;

function ObstaclePool({ stateRef, sizeRef }: { stateRef: Scene3DProps["stateRef"]; sizeRef: Scene3DProps["sizeRef"] }) {
  const groups = useRef<THREE.Group[]>([]);
  const boxRefs = useRef<THREE.Mesh[]>([]);
  const cylRefs = useRef<THREE.Mesh[]>([]);
  const coneRefs = useRef<THREE.Mesh[]>([]);
  const headRefs = useRef<THREE.Mesh[]>([]);
  const accentRefs = useRef<THREE.Mesh[]>([]);
  const wheelLRefs = useRef<THREE.Mesh[]>([]);
  const wheelRRefs = useRef<THREE.Mesh[]>([]);
  const shadowRefs = useRef<THREE.Mesh[]>([]);

  useFrame(() => {
    const st = stateRef.current;
    const { height } = sizeRef.current;
    const roadY = roadYOld(height);
    for (let i = 0; i < N_OBSTACLES; i++) {
      const g = groups.current[i];
      const box = boxRefs.current[i], cyl = cylRefs.current[i], cone = coneRefs.current[i];
      const head = headRefs.current[i], accent = accentRefs.current[i];
      const wl = wheelLRefs.current[i], wr = wheelRRefs.current[i];
      const shadow = shadowRefs.current[i];
      if (!g || !box || !cyl || !cone || !head || !accent || !wl || !wr) continue;
      const o = st.obstacles[i];
      if (!o) { g.position.set(0, 0, HIDE_Z); continue; }
      const w = Math.max(0.5, o.obsWidth * 0.028);
      const h = Math.max(0.4, o.obsHeight * 0.02);
      const kind = OBSTACLE_KIND[o.type] || "box";
      const color = OBSTACLE_COLORS[o.type] || "#888888";
      const glow = OBSTACLE_GLOW[o.type] ?? false;
      const metal = OBSTACLE_METAL[o.type] ?? false;
      const applyFinish = (mat: THREE.MeshStandardMaterial, baseColor: string) => {
        mat.color.set(baseColor);
        mat.emissive.set(glow ? baseColor : "#000000");
        mat.emissiveIntensity = glow ? 0.45 : 0;
        mat.metalness = metal ? 0.65 : 0.15;
        mat.roughness = metal ? 0.28 : 0.75;
      };

      // ── Wobble / sway animation ─────────────────────────────────────
      const wobble = OBSTACLE_WOBBLE[o.type] || [0.08, 0.04, 0];
      const phase = i * 2.37;
      const t = st.time;
      const wobbleAmt = Math.sin(t * wobble[0] + phase) * wobble[1];
      if (wobble[2] === 0) {          // z-tilt (lean)
        g.rotation.set(0, 0, wobbleAmt);
      } else if (wobble[2] === 1) {   // y-spin (sway)
        g.rotation.set(0, wobbleAmt, 0);
      } else {                        // y-position (bob)
        g.rotation.set(0, 0, 0);
      }
      const bobY = wobble[2] === 2 ? Math.abs(wobbleAmt) * 0.5 : 0;

      g.position.set(LANE_X + o.lane * LANE_OFFSET, bobY, worldZ(o.x + o.obsWidth / 2));

      // Ground shadow ellipse — darker when obstacle is near, fades with bob
      if (shadow) {
        shadow.visible = true;
        shadow.scale.set(w * 1.25, 1, w * 0.55);
        const shadowMat = shadow.material as THREE.MeshBasicMaterial;
        shadowMat.opacity = Math.max(0, 0.28 - bobY * 0.08);
      }

      box.visible = kind === "box";
      cyl.visible = kind === "cylinder" || kind === "sign";
      cone.visible = kind === "cone";
      head.visible = kind === "animal";
      accent.visible = kind === "sign" || (kind === "cylinder" && (o.type === "hydrant" || o.type === "trashcan"));
      wl.visible = kind === "bicycle";
      wr.visible = kind === "bicycle";

      if (kind === "box") {
        box.scale.set(w, h, 0.5);
        box.position.set(0, h / 2, 0);
        applyFinish(box.material as THREE.MeshStandardMaterial, color);
      } else if (kind === "cylinder") {
        cyl.scale.set(w * 0.5, h, w * 0.5);
        cyl.position.set(0, h / 2, 0);
        applyFinish(cyl.material as THREE.MeshStandardMaterial, color);
        if (accent.visible) {
          accent.position.set(0, h + 0.06, 0);
          accent.scale.set(w * 0.65, 0.12, w * 0.65);
          const accentMat = accent.material as THREE.MeshStandardMaterial;
          accentMat.color.set(CHROME_ACCENT);
          accentMat.metalness = 0.75; accentMat.roughness = 0.2;
          accentMat.emissive.set("#000000"); accentMat.emissiveIntensity = 0;
        }
      } else if (kind === "cone" || o.type === "gnome") {
        cone.visible = true;
        cone.scale.set(w * 0.5, h, w * 0.5);
        cone.position.set(0, h / 2, 0);
        applyFinish(cone.material as THREE.MeshStandardMaterial, color);
      } else if (kind === "animal") {
        box.visible = true;
        box.scale.set(w, h * 0.65, 0.42);
        box.position.set(0, h * 0.32, 0);
        applyFinish(box.material as THREE.MeshStandardMaterial, color);
        head.position.set(0, h * 0.72, 0.18);
        head.scale.setScalar(Math.max(0.14, h * 0.32));
        // flamingo gets a warm pink snout; cat gets sandy; dogs get dark brown
        const headColor = o.type === "cat" ? "#c9a876" : o.type === "flamingo" ? "#ff9ec8" : "#5a3b1e";
        applyFinish(head.material as THREE.MeshStandardMaterial, headColor);
      } else if (kind === "bicycle") {
        box.visible = true;
        box.scale.set(w, h * 0.16, 0.14);
        box.position.set(0, h * 0.55, 0);
        applyFinish(box.material as THREE.MeshStandardMaterial, color);
        wl.position.set(-w * 0.32, h * 0.28, 0);
        wr.position.set(w * 0.32, h * 0.28, 0);
        wl.scale.setScalar(h * 0.28); wr.scale.setScalar(h * 0.28);
      } else if (kind === "sign") {
        cyl.visible = true;
        cyl.scale.set(0.05, h, 0.05);
        cyl.position.set(0, h / 2, 0);
        const poleMat = cyl.material as THREE.MeshStandardMaterial;
        poleMat.color.set(CHROME_ACCENT); poleMat.metalness = 0.75; poleMat.roughness = 0.2;
        poleMat.emissive.set("#000000"); poleMat.emissiveIntensity = 0;
        accent.visible = true;
        accent.position.set(0, h * 0.92, 0);
        accent.rotation.set(0, 0, Math.PI / 8);
        accent.scale.set(w * 0.6, 0.08, w * 0.6);
        applyFinish(accent.material as THREE.MeshStandardMaterial, color);
      } else if (kind === "barrier") {
        // Overhead gantry: a neon beam hung at the slide-under gap height
        // (gapWorld = the exact BARRIER_GAP ceiling used by collision) plus
        // two side posts down to the road. Reuse box=beam, cyl=left post,
        // accent=right post.
        const gapWorld = worldY(roadY - BARRIER_GAP, roadY);
        const beamThick = 0.34, beamW = 1.3, postW = 0.14;
        const postH = gapWorld + beamThick;
        box.visible = true;
        box.scale.set(beamW, beamThick, 0.5);
        box.position.set(0, gapWorld + beamThick / 2, 0);
        applyFinish(box.material as THREE.MeshStandardMaterial, color);
        cyl.visible = true;
        cyl.scale.set(postW, postH, postW);
        cyl.position.set(-beamW / 2 + postW / 2, postH / 2, 0);
        applyFinish(cyl.material as THREE.MeshStandardMaterial, color);
        accent.visible = true;
        accent.rotation.set(0, 0, 0);
        accent.scale.set(postW, postH, postW);
        accent.position.set(beamW / 2 - postW / 2, postH / 2, 0);
        applyFinish(accent.material as THREE.MeshStandardMaterial, color);
      }
    }
  });

  return (
    <>
      {Array.from({ length: N_OBSTACLES }).map((_, i) => (
        <group key={i} ref={(r) => { if (r) groups.current[i] = r; }} position={[0, 0, HIDE_Z]}>
          {/* Soft ground shadow ellipse */}
          <mesh ref={(r) => { if (r) shadowRefs.current[i] = r; }}
                rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} visible={false}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.25} depthWrite={false} />
          </mesh>
          <mesh ref={(r) => { if (r) boxRefs.current[i] = r; }} castShadow>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#888888" />
          </mesh>
          <mesh ref={(r) => { if (r) cylRefs.current[i] = r; }} castShadow>
            <cylinderGeometry args={[1, 1, 1, 12]} />
            <meshStandardMaterial color="#888888" />
          </mesh>
          <mesh ref={(r) => { if (r) coneRefs.current[i] = r; }} castShadow>
            <coneGeometry args={[1, 1, 10]} />
            <meshStandardMaterial color="#e8720c" />
          </mesh>
          <mesh ref={(r) => { if (r) headRefs.current[i] = r; }} castShadow>
            <sphereGeometry args={[1, 8, 8]} />
            <meshStandardMaterial color="#c9a876" />
          </mesh>
          <mesh ref={(r) => { if (r) accentRefs.current[i] = r; }} castShadow>
            <cylinderGeometry args={[1, 1, 1, 8]} />
            <meshStandardMaterial color="#c8c8c8" />
          </mesh>
          <mesh ref={(r) => { if (r) wheelLRefs.current[i] = r; }} castShadow>
            <torusGeometry args={[0.7, 0.12, 8, 16]} />
            <meshStandardMaterial color="#111111" />
          </mesh>
          <mesh ref={(r) => { if (r) wheelRRefs.current[i] = r; }} castShadow>
            <torusGeometry args={[0.7, 0.12, 8, 16]} />
            <meshStandardMaterial color="#111111" />
          </mesh>
        </group>
      ))}
    </>
  );
}

function CoinPool({ stateRef, sizeRef }: { stateRef: Scene3DProps["stateRef"]; sizeRef: Scene3DProps["sizeRef"] }) {
  const refs = useRef<THREE.Mesh[]>([]);
  useFrame((_, delta) => {
    const st = stateRef.current;
    const { height } = sizeRef.current;
    const roadY = roadYOld(height);
    for (let i = 0; i < N_COINS; i++) {
      const m = refs.current[i]; if (!m) continue;
      const c = st.coins[i];
      if (!c) { m.position.set(0, 0, HIDE_Z); continue; }
      m.position.set(LANE_X, worldY(c.y, roadY) + Math.sin(st.time * 0.15 + c.phase) * 0.08, worldZ(c.x));
      m.rotation.y += delta * 6;
    }
  });
  return (
    <>
      {Array.from({ length: N_COINS }).map((_, i) => (
        <mesh key={i} ref={(r) => { if (r) refs.current[i] = r; }} position={[0, 0, HIDE_Z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.24, 0.24, 0.06, 16]} />
          <meshStandardMaterial color="#ffd700" emissive="#ffaa00" emissiveIntensity={0.6} metalness={0.85} roughness={0.15} />
        </mesh>
      ))}
    </>
  );
}

function PowerUpPool({ stateRef, sizeRef }: { stateRef: Scene3DProps["stateRef"]; sizeRef: Scene3DProps["sizeRef"] }) {
  const refs = useRef<THREE.Mesh[]>([]);
  const colors = POWERUP_COLORS;
  useFrame((_, delta) => {
    const st = stateRef.current;
    const { height } = sizeRef.current;
    const roadY = roadYOld(height);
    for (let i = 0; i < N_POWERUPS; i++) {
      const m = refs.current[i]; if (!m) continue;
      const p = st.powerUps[i];
      if (!p) { m.position.set(0, 0, HIDE_Z); continue; }
      m.position.set(LANE_X, worldY(p.y, roadY), worldZ(p.x));
      m.rotation.y += delta * 3;
      const pm = m.material as THREE.MeshStandardMaterial;
      pm.color.set(colors[p.type] || "#ffffff");
      pm.emissive.set(colors[p.type] || "#ffffff");
      pm.metalness = 0.5; pm.roughness = 0.2;
    }
  });
  return (
    <>
      {Array.from({ length: N_POWERUPS }).map((_, i) => (
        <mesh key={i} ref={(r) => { if (r) refs.current[i] = r; }} position={[0, 0, HIDE_Z]} castShadow>
          <octahedronGeometry args={[0.32, 0]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.95} />
        </mesh>
      ))}
    </>
  );
}

function ParticlePool({ stateRef, sizeRef }: { stateRef: Scene3DProps["stateRef"]; sizeRef: Scene3DProps["sizeRef"] }) {
  const refs = useRef<THREE.Mesh[]>([]);
  useFrame(() => {
    const st = stateRef.current;
    const { height } = sizeRef.current;
    const roadY = roadYOld(height);
    for (let i = 0; i < N_PARTICLES; i++) {
      const m = refs.current[i]; if (!m) continue;
      const p = st.particles[i];
      if (!p) { m.position.set(0, 0, HIDE_Z); continue; }
      const s = Math.max(0.03, p.size * 0.014);
      m.position.set(LANE_X + (p.x - FINGER_CENTER_X) * 0.006, worldY(p.y, roadY), worldZ(FINGER_CENTER_X) + s * 0);
      m.position.z = worldZ(p.x < 0 ? 0 : p.x) - 0.02 * i;
      m.scale.setScalar(s);
      const alpha = Math.max(0.05, p.life / 70);
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.set(p.color);
      mat.opacity = alpha; mat.transparent = true;
    }
  });
  return (
    <>
      {Array.from({ length: N_PARTICLES }).map((_, i) => (
        <mesh key={i} ref={(r) => { if (r) refs.current[i] = r; }} position={[0, 0, HIDE_Z]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={1} />
        </mesh>
      ))}
    </>
  );
}

function BloodPuddlePool({ stateRef, sizeRef }: { stateRef: Scene3DProps["stateRef"]; sizeRef: Scene3DProps["sizeRef"] }) {
  const refs = useRef<THREE.Mesh[]>([]);
  useFrame(() => {
    const st = stateRef.current;
    const { height } = sizeRef.current;
    const roadY = roadYOld(height);
    for (let i = 0; i < N_PUDDLES; i++) {
      const m = refs.current[i]; if (!m) continue;
      const bp = st.bloodPuddles[i];
      if (!bp) { m.position.set(0, 0, HIDE_Z); continue; }
      m.position.set(LANE_X, 0.01, worldZ(bp.x));
      m.scale.set(bp.rx * 0.03, bp.ry * 0.03, 1);
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.min(0.8, (bp.life / bp.maxLife) * 0.8);
    }
  });
  return (
    <>
      {Array.from({ length: N_PUDDLES }).map((_, i) => (
        <mesh key={i} ref={(r) => { if (r) refs.current[i] = r; }} position={[0, 0, HIDE_Z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1, 20]} />
          <meshStandardMaterial color="#8B0000" transparent opacity={0.7} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

function PlatformPool({ stateRef, sizeRef }: { stateRef: Scene3DProps["stateRef"]; sizeRef: Scene3DProps["sizeRef"] }) {
  const refs = useRef<THREE.Mesh[]>([]);
  useFrame(() => {
    const st = stateRef.current;
    const { height } = sizeRef.current;
    const roadY = roadYOld(height);
    for (let i = 0; i < N_PLATFORMS; i++) {
      const m = refs.current[i]; if (!m) continue;
      const plat = st.platforms[i];
      if (!plat) { m.position.set(0, 0, HIDE_Z); continue; }
      m.position.set(LANE_X, worldY(plat.y, roadY), worldZ(plat.x + plat.w / 2));
      m.scale.set(Math.max(0.3, plat.w * 0.028), 0.15, 0.9);
    }
  });
  return (
    <>
      {Array.from({ length: N_PLATFORMS }).map((_, i) => (
        <mesh key={i} ref={(r) => { if (r) refs.current[i] = r; }} position={[0, 0, HIDE_Z]} castShadow receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#00aaff" emissive="#0088cc" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </>
  );
}

function RopePool({ stateRef, sizeRef }: { stateRef: Scene3DProps["stateRef"]; sizeRef: Scene3DProps["sizeRef"] }) {
  // Scrolling world ropes get their own N_ROPES slots (matching the original
  // unbounded 2D behavior); the active swing grip gets one dedicated slot on
  // top, so swinging never displaces a scrolling rope from view.
  const refs = useRef<THREE.Group[]>([]);
  const lineRefs = useRef<THREE.Mesh[]>([]);
  const activeGroupRef = useRef<THREE.Group>(null);
  const activeLineRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const st = stateRef.current;
    const { height } = sizeRef.current;
    const roadY = roadYOld(height);
    const active = st.activeSwing;

    const positionRope = (g: THREE.Group, line: THREE.Mesh, ax: number, ay: number, ex: number, ey: number) => {
      g.position.set(0, 0, 0);
      const wax = worldZ(ax), way = worldY(ay, roadY);
      const wex = worldZ(ex), wey = worldY(ey, roadY);
      const midY = (way + wey) / 2, midZ = (wax + wex) / 2;
      line.position.set(LANE_X, midY, midZ);
      const dz = wex - wax; const dy = wey - way;
      const len = Math.max(0.05, Math.hypot(dz, dy));
      line.scale.set(1, len, 1);
      line.rotation.z = 0;
      line.rotation.x = Math.atan2(dz, dy) + Math.PI;
    };

    for (let i = 0; i < N_ROPES; i++) {
      const g = refs.current[i]; const line = lineRefs.current[i];
      if (!g || !line) continue;
      const rope = st.ropes[i];
      if (!rope) { g.position.set(0, 0, HIDE_Z); continue; }
      positionRope(g, line, rope.x, rope.anchorY, rope.x, rope.anchorY + rope.length);
    }

    if (activeGroupRef.current && activeLineRef.current) {
      if (active) {
        positionRope(
          activeGroupRef.current, activeLineRef.current,
          active.anchorX, active.anchorY,
          FINGER_CENTER_X, st.playerY + FINGER_TIP_OFFSET - 80,
        );
      } else {
        activeGroupRef.current.position.set(0, 0, HIDE_Z);
      }
    }
  });
  return (
    <>
      {Array.from({ length: N_ROPES }).map((_, i) => (
        <group key={i} ref={(r) => { if (r) refs.current[i] = r; }} position={[0, 0, HIDE_Z]}>
          <mesh ref={(r) => { if (r) lineRefs.current[i] = r; }}>
            <cylinderGeometry args={[0.04, 0.04, 1, 6]} />
            <meshStandardMaterial color="#ffcc00" emissive="#ffaa00" emissiveIntensity={0.5} />
          </mesh>
        </group>
      ))}
      <group ref={activeGroupRef} position={[0, 0, HIDE_Z]}>
        <mesh ref={activeLineRef}>
          <cylinderGeometry args={[0.04, 0.04, 1, 6]} />
          <meshStandardMaterial color="#ffcc00" emissive="#ffaa00" emissiveIntensity={0.5} />
        </mesh>
      </group>
    </>
  );
}

// ── Runner character (Lefty & Middy) ─────────────────────────────────────
// HAT_COLORS comes from the shared coords.ts re-export (see import above).

function Runner({ stateRef, sizeRef, hat, saber, skin }: { stateRef: Scene3DProps["stateRef"]; sizeRef: Scene3DProps["sizeRef"]; hat: HatId; saber: SaberInfo; skin: SkinInfo }) {
  const group = useRef<THREE.Group>(null);
  const leftFinger = useRef<THREE.Group>(null);
  const rightFinger = useRef<THREE.Group>(null);
  const legLFL = useRef<THREE.Mesh>(null);
  const legLFR = useRef<THREE.Mesh>(null);
  const legRFL = useRef<THREE.Mesh>(null);
  const legRFR = useRef<THREE.Mesh>(null);
  const hatMeshTop = useRef<THREE.Mesh>(null);
  const hatMeshBrim = useRef<THREE.Mesh>(null);
  const saberBlade = useRef<THREE.Mesh>(null);
  const saberGroup = useRef<THREE.Group>(null);

  // Reach 120–185 (game px) → blade length ~0.62–1.05 world units
  const bladeLen = useMemo(() => 0.62 + ((saber.reach - 120) / (185 - 120)) * 0.43, [saber.reach]);
  const bladeHalfLen = bladeLen / 2 + 0.16;

  useFrame(() => {
    const st = stateRef.current;
    const { height } = sizeRef.current;
    const roadY = roadYOld(height);
    if (!group.current) return;

    let stretchY = 1, stretchX = 1;
    if (st.gameRunning && !st.onGround) {
      stretchY = 1 + Math.max(-0.10, Math.min(0.16, -st.velocity * 0.011));
      stretchX = 1 - (stretchY - 1) * 0.55;
    }
    if (st.landImpact > 0) {
      const k = st.landImpact / 10;
      stretchY = 1 - 0.26 * k;
      stretchX = 1 + 0.26 * k;
    }
    if (st.gameRunning && st.sliding) {
      // Duck/slide: squash low and wide so the runner clearly ducks the beam.
      stretchY = 0.5;
      stretchX = 1.28;
    }
    const footY = worldY(st.playerY + FINGER_TIP_OFFSET, roadY);
    group.current.position.set(LANE_X + st.laneVisual * LANE_OFFSET, footY, worldZ(FINGER_CENTER_X));
    group.current.scale.set(stretchX, stretchY, stretchX);
    group.current.rotation.x = (st.gameRunning && st.sliding) ? 0.55 : 0; // forward slide lean
    // Bank into lane switches — laneVel drives a dynamic body lean
    group.current.rotation.z = -st.laneVel * 0.55;

    if (st.shake > 0) {
      group.current.position.x += (Math.random() - 0.5) * st.shake * 0.01;
    }

    const running = st.gameRunning && st.onGround;
    const runPhase = st.time * 0.35;
    const legSwing = running ? Math.sin(runPhase) * 0.55 : (st.onGround ? 0 : 0.35);
    if (legLFL.current) legLFL.current.rotation.x = legSwing;
    if (legLFR.current) legLFR.current.rotation.x = -legSwing;
    if (legRFL.current) legRFL.current.rotation.x = -legSwing;
    if (legRFR.current) legRFR.current.rotation.x = legSwing;

    if (leftFinger.current) leftFinger.current.position.x = -0.28;
    if (rightFinger.current) rightFinger.current.position.x = 0.28;

    // Saber swing animation
    if (saberGroup.current) {
      const active = st.saberSwing > 0;
      saberGroup.current.visible = true;
      const progress = active ? 1 - st.saberSwing / 16 : 0;
      const angle = active ? -1.4 + progress * 2.6 : -1.1;
      saberGroup.current.rotation.z = angle;
      if (saberBlade.current) {
        const mat = saberBlade.current.material as THREE.MeshStandardMaterial;
        mat.color.set(saber.color);
        mat.emissive.set(saber.glow);
        mat.emissiveIntensity = active ? 1.8 : 0.8;
      }
    }

    if (hatMeshTop.current) {
      const spin = hat === "propeller" ? st.time * 0.6 : 0;
      hatMeshTop.current.rotation.y = spin;
    }
  });

  return (
    <group ref={group} visible={false}>
      {/* Back of the hand — both fingers visibly attach to this so the pair
          reads as "two fingers of one hand", not two disconnected legs. */}
      <mesh castShadow position={[0, 1.62, -0.02]}>
        <boxGeometry args={[0.62, 0.34, 0.32]} />
        <meshStandardMaterial color={skin.backHand} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.62, 0.15]}>
        <sphereGeometry args={[0.17, 16, 12]} />
        <meshStandardMaterial color={skin.backHand} roughness={0.7} />
      </mesh>

      {/* Left finger — Lefty */}
      <group ref={leftFinger}>
        {/* Upper segment (attaches to the hand) */}
        <mesh castShadow position={[0, 1.12, 0]}>
          <capsuleGeometry args={[0.2, 0.5, 8, 14]} />
          <meshStandardMaterial color={skin.finger} roughness={0.7} />
        </mesh>
        {/* Knuckle joint */}
        <mesh castShadow position={[0, 0.72, 0]}>
          <sphereGeometry args={[0.205, 16, 12]} />
          <meshStandardMaterial color={skin.knuckle} roughness={0.7} />
        </mesh>
        {/* Lower segment / foot — the fingertip touches the ground here.
            Nail and cute cartoon eyes are nested as children so they swing
            with the leg's run animation instead of floating separately. */}
        <mesh ref={legLFL} castShadow position={[0, 0.4, 0]}>
          <capsuleGeometry args={[0.19, 0.42, 8, 14]} />
          <meshStandardMaterial color={skin.finger} roughness={0.7} />
          {/* Fingernail — rounded/domed rather than a flat box, with a
              subtle gloss highlight for a manicured look. */}
          <mesh castShadow position={[0, -0.24, 0.16]} rotation={[-0.3, 0, 0]} scale={[1, 0.85, 0.55]}>
            <sphereGeometry args={[0.135, 14, 10]} />
            <meshStandardMaterial color={skin.nail} metalness={0.25} roughness={0.25} />
          </mesh>
          {/* Cute cartoon face — gives Lefty personality instead of a bare stick. */}
          <mesh position={[-0.08, -0.16, 0.185]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={0.25} />
          </mesh>
          <mesh position={[-0.08, -0.16, 0.225]}>
            <sphereGeometry args={[0.024, 8, 6]} />
            <meshStandardMaterial color="#1a1410" roughness={0.4} />
          </mesh>
          <mesh position={[0.08, -0.16, 0.185]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={0.25} />
          </mesh>
          <mesh position={[0.08, -0.16, 0.225]}>
            <sphereGeometry args={[0.024, 8, 6]} />
            <meshStandardMaterial color="#1a1410" roughness={0.4} />
          </mesh>
        </mesh>
      </group>
      {/* Right finger — Middy */}
      <group ref={rightFinger}>
        <mesh castShadow position={[0, 1.12, 0]}>
          <capsuleGeometry args={[0.2, 0.5, 8, 14]} />
          <meshStandardMaterial color={skin.finger} roughness={0.7} />
        </mesh>
        <mesh castShadow position={[0, 0.72, 0]}>
          <sphereGeometry args={[0.205, 16, 12]} />
          <meshStandardMaterial color={skin.knuckle} roughness={0.7} />
        </mesh>
        <mesh ref={legRFL} castShadow position={[0, 0.4, 0]}>
          <capsuleGeometry args={[0.19, 0.42, 8, 14]} />
          <meshStandardMaterial color={skin.finger} roughness={0.7} />
          <mesh castShadow position={[0, -0.24, 0.16]} rotation={[-0.3, 0, 0]} scale={[1, 0.85, 0.55]}>
            <sphereGeometry args={[0.135, 14, 10]} />
            <meshStandardMaterial color={skin.nail} metalness={0.25} roughness={0.25} />
          </mesh>
          <mesh position={[-0.08, -0.16, 0.185]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={0.25} />
          </mesh>
          <mesh position={[-0.08, -0.16, 0.225]}>
            <sphereGeometry args={[0.024, 8, 6]} />
            <meshStandardMaterial color="#1a1410" roughness={0.4} />
          </mesh>
          <mesh position={[0.08, -0.16, 0.185]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={0.25} />
          </mesh>
          <mesh position={[0.08, -0.16, 0.225]}>
            <sphereGeometry args={[0.024, 8, 6]} />
            <meshStandardMaterial color="#1a1410" roughness={0.4} />
          </mesh>
        </mesh>
      </group>

      {/* Hat (equipped) */}
      {hat !== "none" && (
        <group position={[0, 1.85, 0.05]}>
          {hat === "tophat" && (<>
            <mesh ref={hatMeshTop} castShadow><cylinderGeometry args={[0.2, 0.2, 0.34, 10]} /><meshStandardMaterial color={HAT_COLORS[hat]} /></mesh>
            <mesh ref={hatMeshBrim} position={[0, -0.18, 0]}><cylinderGeometry args={[0.3, 0.3, 0.04, 10]} /><meshStandardMaterial color={HAT_COLORS[hat]} /></mesh>
          </>)}
          {hat === "cap" && (<mesh ref={hatMeshTop} castShadow><sphereGeometry args={[0.24, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.8]} /><meshStandardMaterial color={HAT_COLORS[hat]} /></mesh>)}
          {hat === "crown" && (<mesh ref={hatMeshTop} castShadow><torusGeometry args={[0.2, 0.08, 8, 12]} /><meshStandardMaterial color={HAT_COLORS[hat]} emissive="#886600" emissiveIntensity={0.65} metalness={0.9} roughness={0.15} /></mesh>)}
          {hat === "cowboy" && (<mesh ref={hatMeshTop} castShadow><coneGeometry args={[0.16, 0.22, 10]} /><meshStandardMaterial color={HAT_COLORS[hat]} /></mesh>)}
          {hat === "viking" && (<>
            <mesh ref={hatMeshTop} castShadow><sphereGeometry args={[0.22, 10, 8]} /><meshStandardMaterial color={HAT_COLORS[hat]} /></mesh>
            <mesh position={[-0.24, 0, 0]} rotation={[0, 0, 0.6]}><coneGeometry args={[0.05, 0.26, 6]} /><meshStandardMaterial color="#e8e0c8" /></mesh>
            <mesh position={[0.24, 0, 0]} rotation={[0, 0, -0.6]}><coneGeometry args={[0.05, 0.26, 6]} /><meshStandardMaterial color="#e8e0c8" /></mesh>
          </>)}
          {hat === "beanie" && (<mesh ref={hatMeshTop} castShadow><sphereGeometry args={[0.23, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.6]} /><meshStandardMaterial color={HAT_COLORS[hat]} /></mesh>)}
          {hat === "party" && (<mesh ref={hatMeshTop} castShadow><coneGeometry args={[0.2, 0.4, 8]} /><meshStandardMaterial color={HAT_COLORS[hat]} /></mesh>)}
          {hat === "wizard" && (<mesh ref={hatMeshTop} castShadow><coneGeometry args={[0.2, 0.5, 8]} /><meshStandardMaterial color={HAT_COLORS[hat]} /></mesh>)}
          {hat === "propeller" && (<>
            <mesh ref={hatMeshTop} castShadow><sphereGeometry args={[0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.8]} /><meshStandardMaterial color={HAT_COLORS[hat]} /></mesh>
            <mesh position={[0, 0.24, 0]}><boxGeometry args={[0.5, 0.02, 0.05]} /><meshStandardMaterial color={CHROME_ACCENT} metalness={0.85} roughness={0.15} /></mesh>
          </>)}
          {hat === "halo" && (<mesh ref={hatMeshTop} position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.18, 0.03, 8, 16]} /><meshStandardMaterial color={HAT_COLORS[hat]} emissive="#ffee88" emissiveIntensity={1.6} /></mesh>)}
        </group>
      )}

      {/* Lightsaber — held by the right finger, swings when active. Blade length
          visually tracks the equipped saber's gameplay reach (120–185px) so a
          higher tier saber's larger hitbox is not a surprise to the player. */}
      <group ref={saberGroup} position={[0.28, 0.95, 0.18]} rotation={[0, 0, -1.1]}>
        <mesh castShadow position={[0, 0.12, 0]}><cylinderGeometry args={[0.03, 0.03, 0.18, 6]} /><meshStandardMaterial color={CHROME_ACCENT} metalness={0.85} roughness={0.2} /></mesh>
        <mesh ref={saberBlade} position={[0, bladeHalfLen, 0]}>
          <cylinderGeometry args={[0.025, 0.025, bladeLen, 6]} />
          <meshStandardMaterial color={saber.color} emissive={saber.glow} emissiveIntensity={0.6} />
        </mesh>
      </group>
    </group>
  );
}

// ── Ghibli sky dome + drifting painted clouds ──────────────────────────────
function GhibliSky({ theme }: { theme: Theme3D }) {
  const c = THEME_COLORS[theme];
  const N_CLOUDS = 8;
  const cloudRefs = useRef<THREE.Group[]>([]);
  const seeds = useMemo(() => Array.from({ length: N_CLOUDS }, (_, i) => ({
    x: (i / N_CLOUDS) * 30 - 15,
    y: 4.0 + (i % 3) * 1.1,
    z: -22 - (i % 4) * 9,
    sx: 0.55 + (i * 0.17 % 0.55),
    sy: 0.28 + (i * 0.09 % 0.22),
    speed: 0.006 + (i % 5) * 0.0025,
    opacity: theme === "night" ? 0.12 : 0.70 - (i % 3) * 0.10,
    color: theme === "night" ? "#282040" : theme === "highway" ? "#f0d890" : theme === "city" ? "#f0c888" : "#f5f8f2",
  })), [theme]);

  useFrame((_, delta) => {
    cloudRefs.current.forEach((g, i) => {
      if (!g) return;
      g.position.x -= seeds[i].speed * delta * 60;
      if (g.position.x < -18) g.position.x = 18;
    });
  });

  return (
    <>
      <mesh position={[0, -8, -12]} scale={[120, 65, 120]}>
        <sphereGeometry args={[1, 16, 8]} />
        <meshBasicMaterial color={c.sky} side={THREE.BackSide} fog={false} />
      </mesh>
      {seeds.map((s, i) => (
        <group key={i} ref={(r) => { if (r) cloudRefs.current[i] = r; }} position={[s.x, s.y, s.z]}>
          <mesh scale={[s.sx * 2.6, s.sy * 1.7, s.sx * 1.5]}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshBasicMaterial color={s.color} transparent opacity={s.opacity} fog={false} depthWrite={false} />
          </mesh>
          <mesh position={[s.sx * 1.5, -s.sy * 0.18, 0]} scale={[s.sx * 1.8, s.sy * 1.2, s.sx]}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshBasicMaterial color={s.color} transparent opacity={s.opacity * 0.82} fog={false} depthWrite={false} />
          </mesh>
          <mesh position={[-s.sx * 1.2, -s.sy * 0.22, 0]} scale={[s.sx * 1.3, s.sy * 1.0, s.sx * 0.85]}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshBasicMaterial color={s.color} transparent opacity={s.opacity * 0.72} fog={false} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ── Ambient birds — silhouettes drifting across the sky ────────────────────
function Birds({ theme }: { theme: Theme3D }) {
  const N = 6;
  const refs = useRef<THREE.Group[]>([]);
  const data = useMemo(() => Array.from({ length: N }, (_, i) => ({
    cx: (i / N) * 16 - 8,
    cy: 5.2 + (i % 3) * 0.5,
    z: -16 - (i % 3) * 11,
    r: 4.5 + i * 0.7,
    speed: 0.007 + i * 0.0025,
    angle: (i / N) * Math.PI * 2,
  })), []);
  const color = theme === "night" ? "#6060aa" : theme === "city" ? "#604830" : "#383838";

  useFrame((_, delta) => {
    data.forEach((d, i) => {
      const g = refs.current[i]; if (!g) return;
      d.angle += d.speed * delta * 60;
      g.position.set(d.cx + Math.cos(d.angle) * d.r, d.cy + Math.sin(d.angle * 0.45) * 0.28, d.z);
      g.rotation.y = -(d.angle + Math.PI * 0.5);
      const flap = Math.sin(d.angle * 13) * 0.24;
      if (g.children[0]) (g.children[0] as THREE.Object3D).rotation.z = flap + 0.12;
      if (g.children[1]) (g.children[1] as THREE.Object3D).rotation.z = -flap - 0.12;
    });
  });

  return (
    <>
      {data.map((_, i) => (
        <group key={i} ref={(r) => { if (r) refs.current[i] = r; }}>
          <mesh position={[-0.24, 0, 0]}>
            <boxGeometry args={[0.30, 0.035, 0.10]} />
            <meshBasicMaterial color={color} fog={false} />
          </mesh>
          <mesh position={[0.24, 0, 0]}>
            <boxGeometry args={[0.30, 0.035, 0.10]} />
            <meshBasicMaterial color={color} fog={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ── Background scenery — three Ghibli parallax layers ─────────────────────
function ThemeProps({ stateRef, theme }: { stateRef: Scene3DProps["stateRef"]; theme: Theme3D }) {
  const colors = THEME_COLORS[theme];

  // FAR layer — distant hills/silhouettes, slow parallax, pushed back in Z
  const COUNT_F = 10; const SPACING_F = 22; const SIDE_F = 5.2;
  const farRefs = useRef<THREE.Group[]>([]);
  const farSeeds = useMemo(() => Array.from({ length: COUNT_F }, (_, i) => ({
    side: (i % 2 === 0 ? -1 : 1) as -1|1,
    h: 1.4 + (i % 5) * 0.55,
    w: 1.8 + (i % 4) * 0.45,
    baseZ: -(i * SPACING_F),
    type: i % 3,
  })), [theme]);

  // MID layer — main scene props, normal parallax
  const COUNT_M = 14; const SPACING_M = 14; const SIDE_M = 3.2;
  const midRefs = useRef<THREE.Group[]>([]);
  const midSeeds = useMemo(() => Array.from({ length: COUNT_M }, (_, i) => ({
    side: (i % 2 === 0 ? -1 : 1) as -1|1,
    h: 1.2 + (i % 5) * (theme === "city" ? 0.90 : theme === "mountain" ? 0.65 : 0.30),
    w: 0.8 + (i % 4) * 0.22,
    baseZ: -(i / COUNT_M * COUNT_M * SPACING_M),
    swayPhase: i * 1.37,
  })), [theme]);

  // NEAR layer — foreground detail, fast scroll
  const COUNT_N = 7; const SPACING_N = 8; const SIDE_N = 1.75;
  const nearRefs = useRef<THREE.Group[]>([]);
  const nearSeeds = useMemo(() => Array.from({ length: COUNT_N }, (_, i) => ({
    side: (i % 2 === 0 ? -1 : 1) as -1|1,
    h: 0.25 + (i % 3) * 0.14,
    baseZ: -(i / COUNT_N * COUNT_N * SPACING_N),
    type: i % 4,
  })), [theme]);

  useFrame(() => {
    const st = stateRef.current;
    const scroll = st.worldScroll * 0.032;
    const t = st.time;

    for (let i = 0; i < COUNT_F; i++) {
      const g = farRefs.current[i]; if (!g) continue;
      const s = farSeeds[i];
      const range = COUNT_F * SPACING_F;
      let z = s.baseZ + scroll * 0.38;
      z = ((z % range) + range) % range - range;
      g.position.set(s.side * SIDE_F, s.h * 0.4, z - 38);
    }
    for (let i = 0; i < COUNT_M; i++) {
      const g = midRefs.current[i]; if (!g) continue;
      const s = midSeeds[i];
      const range = COUNT_M * SPACING_M;
      let z = s.baseZ + scroll;
      z = ((z % range) + range) % range - range;
      const sway = (theme === "suburb" || theme === "mountain")
        ? Math.sin(t * 0.038 + s.swayPhase) * 0.038 : 0;
      g.position.set(s.side * SIDE_M + sway, s.h * 0.5, z);
    }
    for (let i = 0; i < COUNT_N; i++) {
      const g = nearRefs.current[i]; if (!g) continue;
      const s = nearSeeds[i];
      const range = COUNT_N * SPACING_N;
      let z = s.baseZ + scroll;
      z = ((z % range) + range) % range - range;
      const sway = Math.sin(t * 0.075 + i * 1.28) * 0.055;
      g.position.set(s.side * SIDE_N + sway, 0, z);
    }
  });

  const farHill = colors.hillFar; const farHill2 = colors.hillMid;

  return (
    <>
      {/* FAR: rolling hills / mountain silhouettes */}
      {farSeeds.map((s, i) => (
        <group key={`f${i}`} ref={(r) => { if (r) farRefs.current[i] = r; }}>
          {s.type === 0 && <mesh castShadow><sphereGeometry args={[s.w, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={farHill} roughness={0.95} /></mesh>}
          {s.type === 1 && <mesh castShadow><coneGeometry args={[s.w * 0.85, s.h * 1.4, 5]} /><meshStandardMaterial color={farHill2} roughness={0.9} /></mesh>}
          {s.type === 2 && (<>
            <mesh position={[0, -s.h * 0.15, 0]}><cylinderGeometry args={[0.07, 0.11, s.h * 0.5, 4]} /><meshStandardMaterial color="#2a1a08" roughness={0.95} /></mesh>
            <mesh position={[0, s.h * 0.22, 0]}><coneGeometry args={[s.w * 0.45, s.h * 0.8, 5]} /><meshStandardMaterial color={farHill} roughness={0.95} /></mesh>
          </>)}
        </group>
      ))}

      {/* MID: main scene props with Ghibli character */}
      {midSeeds.map((s, i) => (
        <group key={`m${i}`} ref={(r) => { if (r) midRefs.current[i] = r; }}>
          {theme === "suburb" && (<>
            <mesh castShadow position={[0, -s.h * 0.12, 0]}><cylinderGeometry args={[s.w * 0.13, s.w * 0.17, s.h * 0.5, 6]} /><meshStandardMaterial color="#4a2808" roughness={0.9} /></mesh>
            <mesh castShadow position={[0, s.h * 0.30, 0]}><sphereGeometry args={[s.w * 0.90, 10, 8]} /><meshStandardMaterial color={colors.prop} roughness={0.65} /></mesh>
            <mesh castShadow position={[0, s.h * 0.64, 0]}><sphereGeometry args={[s.w * 0.56, 8, 6]} /><meshStandardMaterial color={colors.propAccent} roughness={0.55} emissive={colors.propAccent} emissiveIntensity={0.06} /></mesh>
          </>)}
          {theme === "city" && (
            <mesh castShadow><boxGeometry args={[s.w, s.h, s.w * 0.72]} /><meshStandardMaterial color={colors.prop} emissive={colors.propAccent} emissiveIntensity={0.16} metalness={0.35} roughness={0.42} /></mesh>
          )}
          {theme === "highway" && (<>
            <mesh castShadow><boxGeometry args={[0.16, s.h * 0.42, 0.16]} /><meshStandardMaterial color={colors.prop} metalness={0.52} roughness={0.28} /></mesh>
            <mesh position={[0, s.h * 0.24, 0]}><sphereGeometry args={[0.13, 8, 8]} /><meshStandardMaterial color={colors.propAccent} emissive={colors.propAccent} emissiveIntensity={1.2} /></mesh>
          </>)}
          {theme === "mountain" && (<>
            <mesh castShadow position={[0, -s.h * 0.08, 0]}><cylinderGeometry args={[s.w * 0.11, s.w * 0.14, s.h * 0.38, 5]} /><meshStandardMaterial color="#2a1a08" roughness={0.9} /></mesh>
            <mesh castShadow position={[0, s.h * 0.14, 0]}><coneGeometry args={[s.w * 0.78, s.h * 0.85, 6]} /><meshStandardMaterial color={colors.prop} roughness={0.75} /></mesh>
          </>)}
          {theme === "night" && (<>
            <mesh castShadow><boxGeometry args={[s.w, s.h, s.w * 0.72]} /><meshStandardMaterial color={colors.prop} roughness={0.45} /></mesh>
            <mesh position={[0, s.h * 0.14, s.w * 0.36 + 0.01]}><boxGeometry args={[0.09, 0.09, 0.02]} /><meshStandardMaterial color={colors.propAccent} emissive={colors.propAccent} emissiveIntensity={2.0} /></mesh>
          </>)}
        </group>
      ))}

      {/* NEAR: foreground details — flowers, grass, rocks */}
      {nearSeeds.map((s, i) => (
        <group key={`n${i}`} ref={(r) => { if (r) nearRefs.current[i] = r; }}>
          {theme === "suburb" && s.type === 0 && (<>
            <mesh position={[0, s.h * 0.52, 0]}><cylinderGeometry args={[0.025, 0.025, s.h, 4]} /><meshBasicMaterial color="#4a8030" /></mesh>
            <mesh position={[0, s.h * 1.02, 0]}><sphereGeometry args={[0.075, 6, 5]} /><meshBasicMaterial color={i % 2 === 0 ? "#ff5888" : "#ffdd28"} /></mesh>
          </>)}
          {theme === "suburb" && s.type !== 0 && (<>
            <mesh position={[-0.065, s.h * 0.5, 0]} rotation={[0, 0, 0.3]}><boxGeometry args={[0.035, s.h, 0.035]} /><meshBasicMaterial color={colors.hillMid} /></mesh>
            <mesh position={[0, s.h * 0.5, 0]}><boxGeometry args={[0.035, s.h * 0.88, 0.035]} /><meshBasicMaterial color={colors.hillMid} /></mesh>
            <mesh position={[0.065, s.h * 0.45, 0]} rotation={[0, 0, -0.25]}><boxGeometry args={[0.035, s.h * 0.78, 0.035]} /><meshBasicMaterial color={colors.hillMid} /></mesh>
          </>)}
          {theme === "city" && <mesh position={[0, s.h * 0.5, 0]}><boxGeometry args={[0.1, s.h, 0.1]} /><meshBasicMaterial color={colors.hillMid} /></mesh>}
          {theme === "highway" && <mesh position={[0, s.h * 0.28, 0]} rotation={[0, i * 0.52, 0]}><cylinderGeometry args={[0.015, s.h * 0.14, s.h * 0.55, 5]} /><meshBasicMaterial color={colors.hillMid} /></mesh>}
          {theme === "mountain" && <mesh position={[0, s.h * 0.5, 0]}><coneGeometry args={[s.h * 0.38, s.h, 5]} /><meshBasicMaterial color={colors.hillMid} /></mesh>}
          {theme === "night" && <mesh position={[0, s.h * 0.62, 0]}><sphereGeometry args={[0.055, 5, 4]} /><meshBasicMaterial color={colors.propAccent} /></mesh>}
        </group>
      ))}
    </>
  );
}

function GroundAndRoad({ stateRef, theme }: { stateRef: Scene3DProps["stateRef"]; theme: Theme3D }) {
  const colors = THEME_COLORS[theme];
  const dashRefs = useRef<THREE.Mesh[]>([]);
  const N_DASH = 22; const SPACING = 3.2; const RANGE = N_DASH * SPACING;
  useFrame(() => {
    const st = stateRef.current;
    for (let i = 0; i < N_DASH; i++) {
      const m = dashRefs.current[i]; if (!m) continue;
      let z = -(i * SPACING) + st.worldScroll * 0.032;
      z = ((z % RANGE) + RANGE) % RANGE - RANGE;
      m.position.set(0, 0.011, z);
    }
  });
  return (
    <group>
      <mesh position={[0, -0.02, -140]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 320]} />
        <meshStandardMaterial color={colors.shoulder} />
      </mesh>
      <mesh position={[0, 0, -140]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3.4, 320]} />
        <meshStandardMaterial color={colors.road} metalness={0.15} roughness={0.6} />
      </mesh>
      {Array.from({ length: N_DASH }).map((_, i) => (
        <mesh key={i} ref={(r) => { if (r) dashRefs.current[i] = r; }} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.16, 1.1]} />
          <meshStandardMaterial color="#eeeeee" emissive={colors.propAccent} emissiveIntensity={0.15} />
        </mesh>
      ))}
    </group>
  );
}

function CameraRig({ stateRef }: { stateRef: Scene3DProps["stateRef"] }) {
  useFrame(({ camera }) => {
    const st = stateRef.current;
    const bob = st.gameRunning ? worldYSafe(st) : 0;
    camera.position.set(0 + (st.shake > 0 ? (Math.random() - 0.5) * st.shake * 0.02 : 0), 2.35 + bob * 0.12, 5.4);
    camera.lookAt(0, 1.1 + bob * 0.12, -2.5);
  });
  return null;
}
function worldYSafe(st: GameSceneState) {
  return Math.max(0, -st.velocity) * 0.02;
}

function Lighting({ theme, accent }: { theme: Theme3D; accent: string }) {
  const c = THEME_COLORS[theme];
  // Blend the character's saber-glow accent into the sky and fog so each
  // runner gets a subtly different-looking world (Apollo = blue sky tint,
  // Rocco = green tint, Santi = warm amber tint).
  const { bgColor, fogColor } = useMemo(() => {
    const sky = new THREE.Color(c.sky);
    const fog = new THREE.Color(c.fog);
    const acc = new THREE.Color(accent);
    sky.lerp(acc, 0.18);
    fog.lerp(acc, 0.12);
    return { bgColor: sky, fogColor: fog };
  }, [c.sky, c.fog, accent]);
  return (
    <>
      <ambientLight color={c.ambient} intensity={Math.min(1.8, c.sunIntensity * 0.56)} />
      {/* Golden-hour directional sun — angled lower and slightly warmer */}
      <directionalLight
        color={c.sun}
        intensity={c.sunIntensity}
        position={[5, 6, 3]}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={32}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
      />
      {/* Warm fill from opposite side — typical Ghibli cross-lighting */}
      <directionalLight color={c.ambient} intensity={c.sunIntensity * 0.22} position={[-4, 3, -2]} />
      <hemisphereLight color={c.sky} groundColor={c.road} intensity={0.52} />
      {/* Character-tinted neon rim light — uses the active runner's saber-glow
          color so the runner body and road are bathed in their signature hue.
          Apollo runs under blue light, Rocco under green, Santi under amber. */}
      <pointLight color={accent} intensity={0.65} distance={14} decay={2} position={[0, 3, -1.5]} />
      <fog attach="fog" args={[fogColor, 6, theme === "night" ? 38 : 52]} />
      <color attach="background" args={[bgColor]} />
    </>
  );
}

// Real bloom/glow post-processing pass — replaces the old "emissive material
// only" fake neon look with an actual light-bleed halo around bright
// surfaces (obstacle glow, saber blade, powerups, neon rim light, night
// windows). Tuned per theme via BLOOM_CONFIG (see shared lib) so darker
// themes like night/Overdrive Midnight get a stronger bloom than bright
// daytime themes like highway/mountain. `mipmapBlur` uses three.js's mipmap
// chain for the blur (GPU-cheap, no extra full-res passes), and the effect
// only runs once per frame regardless of scene complexity — safe for
// lower-end phones/integrated GPUs.
function NeonBloom({ theme }: { theme: Theme3D }) {
  const cfg = BLOOM_CONFIG[theme];
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom
        intensity={cfg.intensity}
        luminanceThreshold={cfg.threshold}
        luminanceSmoothing={cfg.smoothing}
        mipmapBlur
        radius={0.6}
      />
    </EffectComposer>
  );
}

export default function Scene3D({ stateRef, sizeRef, theme, hat, saber, skin, accent }: Scene3DProps) {
  return (
    <Canvas
      dpr={[1, 1.6]}
      gl={{ antialias: false, alpha: true, powerPreference: "default", failIfMajorPerformanceCaveat: false }}
      style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}
    >
      <PerspectiveCamera makeDefault position={[0, 2.35, 5.4]} fov={62} near={0.1} far={80} />
      <Lighting theme={theme} accent={accent} />
      <GhibliSky theme={theme} />
      <Birds theme={theme} />
      <CameraRig stateRef={stateRef} />
      <GroundAndRoad stateRef={stateRef} theme={theme} />
      <ThemeProps stateRef={stateRef} theme={theme} />
      <Runner stateRef={stateRef} sizeRef={sizeRef} hat={hat} saber={saber} skin={skin} />
      <ObstaclePool stateRef={stateRef} sizeRef={sizeRef} />
      <CoinPool stateRef={stateRef} sizeRef={sizeRef} />
      <PowerUpPool stateRef={stateRef} sizeRef={sizeRef} />
      <ParticlePool stateRef={stateRef} sizeRef={sizeRef} />
      <BloodPuddlePool stateRef={stateRef} sizeRef={sizeRef} />
      <PlatformPool stateRef={stateRef} sizeRef={sizeRef} />
      <RopePool stateRef={stateRef} sizeRef={sizeRef} />
      <NeonBloom theme={theme} />
    </Canvas>
  );
}
