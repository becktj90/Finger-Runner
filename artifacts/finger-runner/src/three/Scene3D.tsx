// ── 3D render layer for Finger Runner ────────────────────────────────────
// Pure rendering: reads the existing (unmodified) physics/game state each
// frame via `stateRef` and imperatively positions Three.js objects. No
// gameplay logic lives here — Game.tsx still owns physics, spawning,
// collision, scoring, and persistence exactly as before.
import { useMemo, useRef, useState, useEffect, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera, Environment, Lightformer, Clone, useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, SMAA, HueSaturation, BrightnessContrast, N8AO, ChromaticAberration } from "@react-three/postprocessing";
import * as THREE from "three";
import {
  FINGER_CENTER_X, LANE_X, LANE_OFFSET, LANE_HIT_RADIUS, worldZ, worldY, roadYOld, THEME_COLORS,
  OBSTACLE_COLORS, OBSTACLE_KIND, POWERUP_COLORS,
  CHROME_ACCENT, OBSTACLE_METAL, OBSTACLE_WOBBLE, BLOOM_CONFIG,
  ROAD_SURFACE_OFFSET, FINGER_TIP_OFFSET, HIDE_Z, BARRIER_GAP,
  POOL_OBSTACLES, POOL_COINS, POOL_PARTICLES, POOL_POWERUPS,
  POOL_PLATFORMS, POOL_ROPES, POOL_PUDDLES,
  type GameSceneState, type Theme3D,
} from "./coords";

// ── Hazard warning ───────────────────────────────────────────────────────
// The single same-lane obstacle you need to react to next lights up and
// grows a soft halo as it closes in, escalating as the reaction window
// narrows — the cue lives directly ON the hazard your eyes are already on,
// instead of an abstract HUD icon floating elsewhere. This also frees up
// "glow" to mean something: ordinary obstacles stay unlit/realistic at rest
// and only light up when they're actually the thing you must act on.
// Mirrors the timing math the 2D HUD label uses, so both agree on the beat.
const WARN_WINDOW = 52;
type WarnType = "JUMP" | "DUCK" | "SLASH";
const WARN_COLOR: Record<WarnType, string> = { JUMP: "#5dff8f", DUCK: "#39d8ff", SLASH: "#ff6ad5" };
const WARN_IDEAL: Record<WarnType, number> = { JUMP: 15, DUCK: 9, SLASH: 12 };
interface WarnInfo { idx: number; type: WarnType; frames: number; urgency: number }
function findWarned(st: GameSceneState): WarnInfo | null {
  let idx = -1; let bestDist = Infinity; let bestType: WarnType = "JUMP";
  for (let i = 0; i < st.obstacles.length; i++) {
    const o = st.obstacles[i];
    if (!o || Math.abs(o.lane - st.steerX) >= LANE_HIT_RADIUS || o.type === "ramp") continue; // ramps are friendly
    const dist = o.x + o.obsWidth * 0.5 - FINGER_CENTER_X;
    if (dist < -12) continue;
    if (dist < bestDist) {
      bestDist = dist; idx = i;
      bestType = o.type === "barrier" ? "DUCK" : o.type === "pinata" ? "SLASH" : "JUMP";
    }
  }
  if (idx < 0) return null;
  const frames = bestDist / Math.max(0.5, st.curSpeed);
  if (frames >= WARN_WINDOW) return null;
  const acting = (bestType === "JUMP" && !st.onGround) || (bestType === "DUCK" && st.sliding) || (bestType === "SLASH" && st.saberSwing > 0);
  if (acting) return null;
  const ideal = WARN_IDEAL[bestType];
  const urgency = Math.max(0, Math.min(1, 1 - (frames - ideal) / (WARN_WINDOW - ideal)));
  return { idx, type: bestType, frames, urgency };
}
// ── Real artist-made models (CC0, Quaternius & friends via poly.pizza) ─────
// These replace the procedural primitive builds for the obstacle types we
// have models for — the single biggest step away from "programmer art".
// Files live in public/models/ and ship with the site.
const MODEL_FILES: Record<string, string> = {
  hydrant: "hydrant.glb", cone: "cone.glb", trashcan: "trashcan.glb",
  mailbox: "mailbox.glb", dog: "dog.glb",
  stopsign: "stopsign.glb", bicycle: "bicycle.glb", ramp: "ramp.glb",
  cat: "cat.glb", duck: "duck.glb", dino: "dino.glb", gnome: "gnome.glb",
  pumpkin: "pumpkin.glb", cactus: "cactus.glb", flamingo: "flamingo.glb",
  toilet: "toilet.glb", pinata: "pinata.glb", poop: "poop.glb",
  cart: "cart.glb", newsbox: "newsbox.glb",
};
// Extra yaw so each model faces the oncoming camera (+z) — some packs author
// their characters looking down -z or sideways.
const MODEL_ROT_Y: Record<string, number> = {
  dog: Math.PI / 2, cat: Math.PI / 2, dino: Math.PI / 2, flamingo: Math.PI / 2,
  duck: Math.PI / 2, mailbox: Math.PI / 2, pinata: Math.PI / 2, cart: Math.PI / 2,
  // Kicker authored with its tall end at +z — flip so the low lip greets the rider
  ramp: Math.PI,
};
const MODEL_TYPE_KEYS = Object.keys(MODEL_FILES);
export const MODELED_OBSTACLES = new Set(MODEL_TYPE_KEYS);
const modelUrl = (f: string) => `${import.meta.env.BASE_URL}models/${f}`;
// Start streaming every model the moment the 3D chunk loads.
MODEL_TYPE_KEYS.forEach((t) => useGLTF.preload(modelUrl(MODEL_FILES[t])));
["tree1.glb", "tree2.glb", "rock.glb"].forEach((f) => useGLTF.preload(modelUrl(f)));
// Playable animal characters (Quaternius CC0) — preload so switching to a
// beast rider never hitches mid-menu.
["char_goat.glb", "char_pig.glb", "char_cow.glb", "char_apollo.glb", "char_rocco.glb", "char_santi.glb"].forEach((f) => useGLTF.preload(modelUrl(f)));

interface ModelTemplate { scene: THREE.Object3D; height: number; minY: number; cx: number; cz: number }

// One mounted model instance for a pool slot: normalized so its feet sit at
// local y=0 and its height is exactly 1 unit (the pool scales it to the
// obstacle's gameplay height). Materials are cloned per instance so the
// hazard warn-glow can light THIS obstacle without lighting its siblings.
function SlotModel({ template, rotY, matsOut }: { template: ModelTemplate; rotY: number; matsOut: (mats: THREE.MeshStandardMaterial[]) => void }) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    const mats: THREE.MeshStandardMaterial[] = [];
    ref.current?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        const src = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
        const cloned = Array.isArray(src) ? src.map((m) => m.clone()) : src.clone();
        mesh.material = cloned;
        (Array.isArray(cloned) ? cloned : [cloned]).forEach((m) => mats.push(m as THREE.MeshStandardMaterial));
      }
    });
    matsOut(mats);
    return () => matsOut([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);
  const s = 1 / Math.max(0.0001, template.height);
  return (
    <group ref={ref} rotation={[0, rotY, 0]} scale={[s, s, s]} position={[0, -template.minY / Math.max(0.0001, template.height), 0]}>
      <Clone object={template.scene} position={[-template.cx, 0, -template.cz]} />
    </group>
  );
}

// Renders the modelled obstacle types over the pool slots. The procedural
// ObstaclePool still owns the slot's ground shadow + warning halo + wobble
// maths; this pool just supplies the artist-made body.
function ModelObstaclePool({ stateRef }: { stateRef: Scene3DProps["stateRef"] }) {
  const gltfs = useGLTF(MODEL_TYPE_KEYS.map((t) => modelUrl(MODEL_FILES[t])));
  const templates = useMemo(() => {
    const out: Record<string, ModelTemplate> = {};
    const box = new THREE.Box3(); const c = new THREE.Vector3(); const size = new THREE.Vector3();
    MODEL_TYPE_KEYS.forEach((t, i) => {
      const scene = (gltfs as { scene: THREE.Object3D }[])[i].scene;
      box.setFromObject(scene); box.getCenter(c); box.getSize(size);
      out[t] = { scene, height: size.y, minY: box.min.y, cx: c.x, cz: c.z };
    });
    return out;
  }, [gltfs]);

  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const matsRef = useRef<THREE.MeshStandardMaterial[][]>([]);
  const [slotTypes, setSlotTypes] = useState<(string | null)[]>(() => Array(N_OBSTACLES).fill(null));
  const slotTypesRef = useRef(slotTypes);
  slotTypesRef.current = slotTypes;

  useFrame(() => {
    const st = stateRef.current;
    const warned = findWarned(st);
    // Reconcile which model each slot should show (React re-renders only on change)
    let changed: (string | null)[] | null = null;
    for (let i = 0; i < N_OBSTACLES; i++) {
      const o = st.obstacles[i];
      const want = o && MODELED_OBSTACLES.has(o.type) ? o.type : null;
      if (slotTypesRef.current[i] !== want) {
        if (!changed) changed = [...slotTypesRef.current];
        changed[i] = want;
      }
    }
    if (changed) setSlotTypes(changed);

    for (let i = 0; i < N_OBSTACLES; i++) {
      const g = groupRefs.current[i]; if (!g) continue;
      const o = st.obstacles[i];
      const t = slotTypesRef.current[i];
      if (!o || !t || o.type !== t) { g.position.set(0, 0, HIDE_Z); continue; }
      const h = Math.max(0.4, o.obsHeight * 0.02);
      const w = Math.max(0.5, o.obsWidth * 0.028);
      // Same wobble personality the procedural pool uses
      const wobble = OBSTACLE_WOBBLE[o.type] || [0.08, 0.04, 0];
      const phase = i * 2.37;
      const wobbleAmt = Math.sin(st.time * wobble[0] + phase) * wobble[1];
      if (wobble[2] === 0) g.rotation.set(0, 0, wobbleAmt);
      else if (wobble[2] === 1) g.rotation.set(0, wobbleAmt, 0);
      else g.rotation.set(0, 0, 0);
      const bobY = wobble[2] === 2 ? Math.abs(wobbleAmt) * 0.5 : 0;
      g.position.set(LANE_X + o.lane * LANE_OFFSET, bobY, worldZ(o.x + o.obsWidth / 2));
      // Uniform scale (height-normalized template × gameplay height) keeps the
      // artist's proportions intact; the hitbox stays gameplay-side.
      void w;
      g.scale.set(h, h, h);
      // Hazard warn glow on this instance's cloned materials
      const isWarned = !!warned && warned.idx === i;
      const mats = matsRef.current[i];
      if (mats) {
        if (isWarned) {
          const pulse = 0.55 + 0.45 * Math.sin(st.time * (0.35 + warned!.urgency * 0.55));
          const glow = 0.3 + warned!.urgency * 1.5 * Math.max(0.35, pulse);
          for (const m of mats) { m.emissive.set(WARN_COLOR[warned!.type]); m.emissiveIntensity = glow; }
        } else {
          for (const m of mats) { if (m.emissiveIntensity !== 0) { m.emissive.set("#000000"); m.emissiveIntensity = 0; } }
        }
      }
    }
  });

  return (
    <>
      {slotTypes.map((t, i) => (
        <group key={i} ref={(r) => { groupRefs.current[i] = r; }} position={[0, 0, HIDE_Z]}>
          {t && (
            <SlotModel
              template={templates[t]}
              rotY={MODEL_ROT_Y[t] ?? 0}
              matsOut={(m) => { matsRef.current[i] = m; }}
            />
          )}
        </group>
      ))}
    </>
  );
}

// Soft radial glow sprite, generated once (module scope — pure canvas, no
// per-theme dependency) and shared/tinted across every warned obstacle.
let haloTexCache: THREE.Texture | null = null;
function getHaloTexture(): THREE.Texture {
  if (haloTexCache) return haloTexCache;
  const S = 128; const cvs = document.createElement("canvas"); cvs.width = cvs.height = S;
  const g = cvs.getContext("2d")!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  haloTexCache = new THREE.CanvasTexture(cvs);
  return haloTexCache;
}

type SaberInfo = { color: string; glow: string; reach: number };
// Per-character runner-body skin tint. Maps onto the 4 hardcoded runner
// colors (back-of-hand, finger segment, knuckle joint, nail). See the
// shared CHARACTERS table for the per-character values.
type SkinInfo = { backHand: string; finger: string; knuckle: string; nail: string };

interface Scene3DProps {
  stateRef: React.MutableRefObject<GameSceneState>;
  sizeRef: React.MutableRefObject<{ width: number; height: number }>;
  theme: Theme3D;
  saber: SaberInfo;
  skin: SkinInfo;
  /** Character's saber-glow hex — used to tint the 3D sky, fog, and rim light
   *  so each runner feels like they own a different world. */
  accent: string;
  /** Currently equipped vehicle id — "vespa" renders the true-3D scooter+rider
   *  avatar in this scene; other vehicles fall back to the 2D HUD rider. */
  vehicle: string;
  /** Optional animal-character GLB (public/models/) — replaces the humanoid
   *  rider body on every vehicle while keeping the saber in hoof. */
  charModel?: string;
  /** Paint-shop override for the vehicle body; undefined = character palette. */
  vehicleColor?: string;
  /** Downhill grade for this level (0 = flat). Tilts the whole world group
   *  around the player (who sits at z=0), so the road visibly drops away
   *  ahead while the camera stays locked dead-centre — no sway, no drift. */
  hill?: number;
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
const SABER_SWING_FRAMES = 16;

function ObstaclePool({ stateRef, sizeRef }: { stateRef: Scene3DProps["stateRef"]; sizeRef: Scene3DProps["sizeRef"] }) {
  const groups = useRef<THREE.Group[]>([]);
  const boxRefs = useRef<THREE.Mesh[]>([]);
  const cylRefs = useRef<THREE.Mesh[]>([]);
  const coneRefs = useRef<THREE.Mesh[]>([]);
  const headRefs = useRef<THREE.Mesh[]>([]);
  const accentRefs = useRef<THREE.Mesh[]>([]);
  const wheelLRefs = useRef<THREE.Mesh[]>([]);
  const wheelRRefs = useRef<THREE.Mesh[]>([]);
  // Two extra generic meshes per obstacle (a box and a cylinder) so everyday
  // items can afford the small identifying parts that make them readable:
  // hydrant nozzle bar, mailbox post, cone stripe, trash-can lid, sign backing.
  const xboxRefs = useRef<THREE.Mesh[]>([]);
  const xcylRefs = useRef<THREE.Mesh[]>([]);
  const shadowRefs = useRef<THREE.Mesh[]>([]);
  const haloRefs = useRef<THREE.Sprite[]>([]);
  const haloTex = useMemo(() => getHaloTexture(), []);

  useFrame(() => {
    const st = stateRef.current;
    const { height } = sizeRef.current;
    const roadY = roadYOld(height);
    const warned = findWarned(st);
    for (let i = 0; i < N_OBSTACLES; i++) {
      const g = groups.current[i];
      const box = boxRefs.current[i], cyl = cylRefs.current[i], cone = coneRefs.current[i];
      const head = headRefs.current[i], accent = accentRefs.current[i];
      const wl = wheelLRefs.current[i], wr = wheelRRefs.current[i];
      const xbox = xboxRefs.current[i], xcyl = xcylRefs.current[i];
      const shadow = shadowRefs.current[i];
      const halo = haloRefs.current[i];
      if (!g || !box || !cyl || !cone || !head || !accent || !wl || !wr || !xbox || !xcyl) continue;
      const o = st.obstacles[i];
      if (!o) { g.position.set(0, 0, HIDE_Z); if (halo) halo.visible = false; continue; }
      const w = Math.max(0.5, o.obsWidth * 0.028);
      const h = Math.max(0.4, o.obsHeight * 0.02);
      const kind = OBSTACLE_KIND[o.type] || "box";
      const color = OBSTACLE_COLORS[o.type] || "#888888";
      const metal = OBSTACLE_METAL[o.type] ?? false;
      const isWarned = !!warned && warned.idx === i;
      // Fast strobe once the reaction window is genuinely urgent, gentle rise before that.
      const pulse = isWarned ? 0.55 + 0.45 * Math.sin(st.time * (0.35 + warned!.urgency * 0.55)) : 0;
      const warnGlow = isWarned ? 0.35 + warned!.urgency * 1.7 * Math.max(0.35, pulse) : 0;
      const warnColor = isWarned ? WARN_COLOR[warned!.type] : "#000000";
      const applyFinish = (mat: THREE.MeshStandardMaterial, baseColor: string) => {
        mat.color.set(baseColor);
        // Ordinary obstacles stay unlit/realistic; only the current hazard you
        // must react to lights up, and only as its window closes.
        mat.emissive.set(isWarned ? warnColor : "#000000");
        mat.emissiveIntensity = isWarned ? warnGlow : 0;
        mat.metalness = metal ? 0.65 : 0.15;
        mat.roughness = metal ? 0.28 : 0.75;
        mat.envMapIntensity = metal ? 1.35 : 0.5;
      };

      // Floating warning halo — a soft billboarded glow above the hazard,
      // growing and quickening its pulse as the reaction window closes.
      if (halo) {
        halo.visible = isWarned;
        if (isWarned) {
          // Barrier's nominal height is the whole gantry — pin its halo to the
          // beam instead of floating it in the sky.
          const haloY = kind === "barrier" ? 1.55 : h + 0.34;
          halo.position.set(0, haloY, 0.08);
          const scale = 0.5 + warned!.urgency * 0.4 + pulse * 0.12;
          halo.scale.setScalar(scale);
          const mat = halo.material as THREE.SpriteMaterial;
          mat.color.set(warnColor);
          mat.opacity = 0.55 + warned!.urgency * 0.35 + pulse * 0.1;
        }
      }

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

      // Soft contact AO under the obstacle. Real shadow-mapped shadows now do
      // the directional grounding; this stays as a faint darkening right at the
      // base so objects read as touching even where the angled shadow is thin.
      if (shadow) {
        shadow.visible = true;
        shadow.scale.set(w * 1.05, 1, w * 0.5);
        const shadowMat = shadow.material as THREE.MeshBasicMaterial;
        shadowMat.opacity = Math.max(0, 0.16 - bobY * 0.06);
      }

      // Types with a real artist-made model get their body from
      // ModelObstaclePool — this pool still runs the slot's ground shadow,
      // warning halo, and wobble, but hides all its primitive shapes.
      if (MODELED_OBSTACLES.has(o.type)) {
        box.visible = cyl.visible = cone.visible = head.visible = accent.visible = false;
        wl.visible = wr.visible = xbox.visible = xcyl.visible = false;
        continue;
      }

      box.visible = kind === "box";
      cyl.visible = kind === "cylinder" || kind === "sign";
      cone.visible = kind === "cone";
      head.visible = kind === "animal";
      accent.visible = kind === "sign" || (kind === "cylinder" && (o.type === "hydrant" || o.type === "trashcan"));
      wl.visible = kind === "bicycle";
      wr.visible = kind === "bicycle";
      xbox.visible = false; xcyl.visible = false;
      xbox.rotation.set(0, 0, 0); xcyl.rotation.set(0, 0, 0);

      if (kind === "box") {
        if (o.type === "mailbox") {
          // US kerbside mailbox: skinny post, deep box body, rounded tunnel
          // top (a half-buried horizontal cylinder), little red flag knob.
          xcyl.visible = true;
          xcyl.scale.set(0.055, h * 0.55, 0.055);
          xcyl.position.set(0, h * 0.28, 0);
          const postMat = xcyl.material as THREE.MeshStandardMaterial;
          postMat.color.set("#5a4632"); postMat.metalness = 0.1; postMat.roughness = 0.85;
          postMat.emissive.set("#000000"); postMat.emissiveIntensity = 0;
          box.scale.set(w * 0.78, h * 0.34, 0.62);
          box.position.set(0, h * 0.68, 0);
          applyFinish(box.material as THREE.MeshStandardMaterial, color);
          xbox.visible = true; // rounded top approximated by a slimmer cap slab
          xbox.scale.set(w * 0.78, h * 0.12, 0.5);
          xbox.position.set(0, h * 0.88, 0);
          applyFinish(xbox.material as THREE.MeshStandardMaterial, color);
          head.visible = true; // red flag
          head.position.set(w * 0.42, h * 0.86, 0.18);
          head.scale.setScalar(0.06);
          const flagMat = head.material as THREE.MeshStandardMaterial;
          flagMat.color.set("#d02020"); flagMat.metalness = 0; flagMat.roughness = 0.6;
          flagMat.emissive.set("#000000"); flagMat.emissiveIntensity = 0;
        } else {
          // newsbox: vending cabinet + inset window + coin slot cap
          box.scale.set(w, h, 0.5);
          box.position.set(0, h / 2, 0);
          applyFinish(box.material as THREE.MeshStandardMaterial, color);
          xbox.visible = true;
          xbox.scale.set(w * 0.72, h * 0.42, 0.06);
          xbox.position.set(0, h * 0.62, 0.24);
          const winMat = xbox.material as THREE.MeshStandardMaterial;
          winMat.color.set("#16202e"); winMat.metalness = 0.4; winMat.roughness = 0.15;
          winMat.emissive.set("#000000"); winMat.emissiveIntensity = 0;
        }
      } else if (kind === "cylinder") {
        if (o.type === "hydrant") {
          // Fire hydrant: squat barrel, domed bonnet, crossbar of side
          // nozzles, and an operating nut on top. Instantly readable.
          cyl.scale.set(w * 0.44, h * 0.78, w * 0.44);
          cyl.position.set(0, h * 0.39, 0);
          applyFinish(cyl.material as THREE.MeshStandardMaterial, color);
          head.visible = true; // domed bonnet
          head.position.set(0, h * 0.8, 0);
          head.scale.set(w * 0.44, w * 0.4, w * 0.44);
          applyFinish(head.material as THREE.MeshStandardMaterial, color);
          xbox.visible = true; // side nozzle crossbar
          xbox.scale.set(w * 1.15, w * 0.3, w * 0.3);
          xbox.position.set(0, h * 0.48, 0);
          applyFinish(xbox.material as THREE.MeshStandardMaterial, color);
          accent.position.set(0, h * 0.98, 0); // operating nut
          accent.scale.set(w * 0.14, 0.1, w * 0.14);
          const nutMat = accent.material as THREE.MeshStandardMaterial;
          nutMat.color.set(CHROME_ACCENT); nutMat.metalness = 0.75; nutMat.roughness = 0.2;
          nutMat.emissive.set("#000000"); nutMat.emissiveIntensity = 0;
        } else if (o.type === "trashcan") {
          // Kerbside bin: ribbed barrel, overhanging lid, arch handle
          cyl.scale.set(w * 0.5, h * 0.86, w * 0.5);
          cyl.position.set(0, h * 0.43, 0);
          applyFinish(cyl.material as THREE.MeshStandardMaterial, color);
          accent.position.set(0, h * 0.9, 0); // lid, wider than the body
          accent.scale.set(w * 0.6, h * 0.1, w * 0.6);
          applyFinish(accent.material as THREE.MeshStandardMaterial, color);
          xbox.visible = true; // arch handle on the lid
          xbox.scale.set(w * 0.36, 0.05, 0.07);
          xbox.position.set(0, h * 1.0, 0);
          const hMat = xbox.material as THREE.MeshStandardMaterial;
          hMat.color.set("#3a3a42"); hMat.metalness = 0.5; hMat.roughness = 0.4;
          hMat.emissive.set("#000000"); hMat.emissiveIntensity = 0;
        } else {
          // pumpkin: squashed orange body + stubby green stem
          cyl.scale.set(w * 0.55, h * 0.8, w * 0.55);
          cyl.position.set(0, h * 0.4, 0);
          applyFinish(cyl.material as THREE.MeshStandardMaterial, color);
          xcyl.visible = true;
          xcyl.scale.set(0.05, 0.16, 0.05);
          xcyl.position.set(0, h * 0.86, 0);
          const stemMat = xcyl.material as THREE.MeshStandardMaterial;
          stemMat.color.set("#3f6b2a"); stemMat.metalness = 0; stemMat.roughness = 0.9;
          stemMat.emissive.set("#000000"); stemMat.emissiveIntensity = 0;
        }
      } else if (kind === "cone" || o.type === "gnome") {
        cone.visible = true;
        cone.rotation.set(0, 0, 0);
        cone.scale.set(w * 0.5, h, w * 0.5);
        cone.position.set(0, h / 2, 0);
        applyFinish(cone.material as THREE.MeshStandardMaterial, color);
        if (o.type === "cone") {
          // Traffic cone extras: square rubber base + reflective white band
          xbox.visible = true;
          xbox.scale.set(w * 0.95, 0.05, w * 0.95);
          xbox.position.set(0, 0.025, 0);
          applyFinish(xbox.material as THREE.MeshStandardMaterial, "#c9560a");
          xcyl.visible = true;
          xcyl.scale.set(w * 0.34, h * 0.14, w * 0.34);
          xcyl.position.set(0, h * 0.46, 0);
          const bandMat = xcyl.material as THREE.MeshStandardMaterial;
          bandMat.color.set("#f2f2f2"); bandMat.metalness = 0.05; bandMat.roughness = 0.35;
          bandMat.emissive.set("#000000"); bandMat.emissiveIntensity = 0;
        }
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
        // The tori double as undies leg-holes elsewhere, so re-assert tire black here
        (wl.material as THREE.MeshStandardMaterial).color.set("#111111");
        (wr.material as THREE.MeshStandardMaterial).color.set("#111111");
      } else if (kind === "poop") {
        // Cartoon poop: squat brown cone swirl with a rounded dollop on top
        cone.visible = true;
        cone.rotation.set(0, 0, 0);
        cone.scale.set(w * 0.62, h * 0.85, w * 0.62);
        cone.position.set(0, h * 0.42, 0);
        applyFinish(cone.material as THREE.MeshStandardMaterial, color);
        head.visible = true;
        head.position.set(0, h * 0.9, 0);
        head.scale.setScalar(Math.max(0.1, w * 0.16));
        applyFinish(head.material as THREE.MeshStandardMaterial, color);
      } else if (kind === "toilet") {
        // Runaway toilet: cylinder bowl + tank box + flattened seat disc
        cyl.visible = true;
        cyl.scale.set(w * 0.42, h * 0.52, w * 0.42);
        cyl.position.set(0, h * 0.26, 0.06);
        applyFinish(cyl.material as THREE.MeshStandardMaterial, color);
        box.visible = true;
        box.scale.set(w * 0.72, h * 0.48, 0.2);
        box.position.set(0, h * 0.74, -0.14);
        applyFinish(box.material as THREE.MeshStandardMaterial, color);
        accent.visible = true;
        accent.rotation.set(0, 0, 0);
        accent.scale.set(w * 0.55, 0.05, w * 0.55);
        accent.position.set(0, h * 0.55, 0.06);
        const seatMat = accent.material as THREE.MeshStandardMaterial;
        seatMat.color.set("#e8e8f0"); seatMat.metalness = 0.1; seatMat.roughness = 0.6;
        seatMat.emissive.set("#000000"); seatMat.emissiveIntensity = 0;
      } else if (kind === "duck") {
        // Giant rubber ducky: yellow body + round head + orange beak
        box.visible = true;
        box.scale.set(w, h * 0.5, 0.46);
        box.position.set(0, h * 0.27, 0);
        applyFinish(box.material as THREE.MeshStandardMaterial, color);
        head.visible = true;
        head.position.set(0, h * 0.72, 0.12);
        head.scale.setScalar(Math.max(0.16, h * 0.3));
        applyFinish(head.material as THREE.MeshStandardMaterial, color);
        cone.visible = true;
        cone.rotation.set(Math.PI / 2, 0, 0);
        cone.scale.set(0.09, 0.2, 0.09);
        cone.position.set(0, h * 0.72, 0.12 + Math.max(0.16, h * 0.3) + 0.08);
        applyFinish(cone.material as THREE.MeshStandardMaterial, "#ff8c1a");
      } else if (kind === "dino") {
        // Toy T-rex: green body + head + tail cone poking out the back
        box.visible = true;
        box.scale.set(w * 0.82, h * 0.6, 0.4);
        box.position.set(0, h * 0.32, 0);
        applyFinish(box.material as THREE.MeshStandardMaterial, color);
        head.visible = true;
        head.position.set(0, h * 0.78, 0.16);
        head.scale.setScalar(Math.max(0.15, h * 0.28));
        applyFinish(head.material as THREE.MeshStandardMaterial, "#2fa83b");
        cone.visible = true;
        cone.rotation.set(-Math.PI / 2, 0, 0);
        cone.scale.set(0.1, 0.38, 0.1);
        cone.position.set(0, h * 0.35, -0.4);
        applyFinish(cone.material as THREE.MeshStandardMaterial, color);
      } else if (kind === "pinata") {
        // Party piñata: glowing candy-pink body + golden topper
        box.visible = true;
        box.scale.set(w, h * 0.62, 0.46);
        box.position.set(0, h * 0.45, 0);
        applyFinish(box.material as THREE.MeshStandardMaterial, color);
        head.visible = true;
        head.position.set(0, h * 0.88, 0);
        head.scale.setScalar(Math.max(0.1, h * 0.16));
        applyFinish(head.material as THREE.MeshStandardMaterial, "#ffee00");
      } else if (kind === "undies") {
        // Giant lost underpants: wide white waistband box + two leg-hole rings
        box.visible = true;
        box.scale.set(w, h * 0.55, 0.3);
        box.position.set(0, h * 0.6, 0);
        applyFinish(box.material as THREE.MeshStandardMaterial, color);
        wl.visible = true; wr.visible = true;
        wl.position.set(-w * 0.24, h * 0.2, 0);
        wr.position.set(w * 0.24, h * 0.2, 0);
        wl.scale.setScalar(Math.max(0.12, h * 0.2)); wr.scale.setScalar(Math.max(0.12, h * 0.2));
        (wl.material as THREE.MeshStandardMaterial).color.set("#dcdcee");
        (wr.material as THREE.MeshStandardMaterial).color.set("#dcdcee");
      } else if (kind === "sign") {
        cyl.visible = true;
        cyl.scale.set(0.05, h, 0.05);
        cyl.position.set(0, h / 2, 0);
        const poleMat = cyl.material as THREE.MeshStandardMaterial;
        poleMat.color.set(CHROME_ACCENT); poleMat.metalness = 0.75; poleMat.roughness = 0.2;
        poleMat.emissive.set("#000000"); poleMat.emissiveIntensity = 0;
        // Stop-sign face: white rim disc behind a red disc, facing the rider
        // (rotated so the flat face points down-road instead of skyward).
        xcyl.visible = true;
        xcyl.rotation.set(Math.PI / 2, 0, 0);
        xcyl.scale.set(w * 0.72, 0.05, w * 0.72);
        xcyl.position.set(0, h * 0.9, -0.01);
        const rimMat = xcyl.material as THREE.MeshStandardMaterial;
        rimMat.color.set("#f0f0f0"); rimMat.metalness = 0.1; rimMat.roughness = 0.4;
        rimMat.emissive.set("#000000"); rimMat.emissiveIntensity = 0;
        accent.visible = true;
        accent.position.set(0, h * 0.9, 0.02);
        accent.rotation.set(Math.PI / 2, 0, 0);
        accent.scale.set(w * 0.62, 0.05, w * 0.62);
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
          {/* "React now" warning halo — shown only on the hazard you must act on */}
          <sprite ref={(r) => { if (r) haloRefs.current[i] = r; }} visible={false}>
            <spriteMaterial map={haloTex} color="#ffffff" transparent depthWrite={false} opacity={0} />
          </sprite>
          <mesh ref={(r) => { if (r) boxRefs.current[i] = r; }} castShadow>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#888888" />
          </mesh>
          <mesh ref={(r) => { if (r) cylRefs.current[i] = r; }} castShadow>
            <cylinderGeometry args={[1, 1, 1, 20]} />
            <meshStandardMaterial color="#888888" />
          </mesh>
          <mesh ref={(r) => { if (r) coneRefs.current[i] = r; }} castShadow>
            <coneGeometry args={[1, 1, 16]} />
            <meshStandardMaterial color="#e8720c" />
          </mesh>
          <mesh ref={(r) => { if (r) headRefs.current[i] = r; }} castShadow>
            <sphereGeometry args={[1, 16, 14]} />
            <meshStandardMaterial color="#c9a876" />
          </mesh>
          <mesh ref={(r) => { if (r) accentRefs.current[i] = r; }} castShadow>
            <cylinderGeometry args={[1, 1, 1, 16]} />
            <meshStandardMaterial color="#c8c8c8" />
          </mesh>
          <mesh ref={(r) => { if (r) wheelLRefs.current[i] = r; }} castShadow>
            <torusGeometry args={[0.7, 0.12, 10, 24]} />
            <meshStandardMaterial color="#111111" />
          </mesh>
          <mesh ref={(r) => { if (r) wheelRRefs.current[i] = r; }} castShadow>
            <torusGeometry args={[0.7, 0.12, 10, 24]} />
            <meshStandardMaterial color="#111111" />
          </mesh>
          <mesh ref={(r) => { if (r) xboxRefs.current[i] = r; }} castShadow visible={false}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#888888" />
          </mesh>
          <mesh ref={(r) => { if (r) xcylRefs.current[i] = r; }} castShadow visible={false}>
            <cylinderGeometry args={[1, 1, 1, 16]} />
            <meshStandardMaterial color="#888888" />
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
          <cylinderGeometry args={[0.27, 0.27, 0.07, 24]} />
          <meshStandardMaterial color="#ffe033" emissive="#ffcc00" emissiveIntensity={1.1} metalness={0.95} roughness={0.08} />
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

// GPU-instanced particle renderer — the whole 100-particle pool is ONE
// InstancedMesh (one draw call, was 100 meshes with 100 standard materials).
// Additive blending makes overlapping particles glow hotter, the bloom pass
// halos the bright ones, and fade-out is done by scaling instance colour
// toward black (with additive blending, black = invisible) — the classic
// GPU-particle technique used by dedicated VFX engines.
function ParticlePool({ stateRef, sizeRef }: { stateRef: Scene3DProps["stateRef"]; sizeRef: Scene3DProps["sizeRef"] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colScratch = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const mesh = meshRef.current; if (!mesh) return;
    const st = stateRef.current;
    const { height } = sizeRef.current;
    const roadY = roadYOld(height);
    for (let i = 0; i < N_PARTICLES; i++) {
      const p = st.particles[i];
      if (!p) {
        dummy.position.set(0, 0, HIDE_Z);
        dummy.scale.setScalar(0.0001);
        dummy.rotation.set(0, 0, 0);
      } else {
        const s = Math.max(0.03, p.size * 0.014);
        dummy.position.set(
          LANE_X + (p.x - FINGER_CENTER_X) * 0.006,
          worldY(p.y, roadY),
          worldZ(p.x < 0 ? 0 : p.x) - 0.02 * i,
        );
        dummy.scale.setScalar(s);
        dummy.rotation.set(0, 0, p.rot ?? 0);
        const alpha = Math.min(1, Math.max(0.05, p.life / 70));
        colScratch.set(p.color).multiplyScalar(alpha);
        mesh.setColorAt(i, colScratch);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, N_PARTICLES]} frustumCulled={false}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshBasicMaterial
        color="#ffffff"
        blending={THREE.AdditiveBlending}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
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
          <meshStandardMaterial color="#00ccff" emissive="#00aaff" emissiveIntensity={1.2} metalness={0.5} roughness={0.3} />
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

// ── Player vehicle + rider — full 3D for every unlockable ride ────────────
// One system renders all nine vehicles with a properly-posed rider: seated on
// the scooter/bikes/trucks, standing side-stance on the boards, straddling
// the rocket, tucked into the UFO dome. Real shadows, scene lighting, exact
// obstacle-lane tracking — the old 2D canvas rider is gone entirely.

type PoseMode = "seated" | "standing" | "straddle" | "dome";
interface VehiclePose {
  riderY: number; riderZ: number; mode: PoseMode; rotY: number;
  bar: [number, number] | null; // handlebar [y, z] in vehicle space (arms reach for it)
  legsFlat?: boolean;           // kart: legs stretched forward
  float?: boolean;              // hovering ride (adds a gentle bob, no ground contact)
  lift?: number;                // extra y so the body's lowest point kisses the road
}
// Meshy AI vehicle bodies. `len` = target world length along z (the ride's
// long axis); riderY replaces the procedural pose's saddle height since each
// model's proportions differ. Vehicles without an entry fall back to the
// procedural build.
// rotY: Meshy authors these side-on (long axis = x, nose at -x); +π/2 swings
// the nose onto +z, which the avatar's 180° flip then points down the road.
const VEHICLE_MODEL: Record<string, { file: string; len: number; riderY: number; lift?: number; rotY: number }> = {
  vespa:        { file: "veh_vespa.glb",        len: 1.60, riderY: 1.06, lift: 0.02, rotY: Math.PI / 2 },
  skateboard:   { file: "veh_skateboard.glb",   len: 0.95, riderY: 0.16, rotY: Math.PI / 2 },
  hoverboard:   { file: "veh_hoverboard.glb",   len: 0.95, riderY: 0.24, rotY: Math.PI / 2 },
  bmx:          { file: "veh_bmx.glb",          len: 1.45, riderY: 0.95, rotY: Math.PI / 2 },
  gokart:       { file: "veh_gokart.glb",       len: 1.40, riderY: 0.50, rotY: Math.PI / 2 },
  firetruck:    { file: "veh_firetruck.glb",    len: 1.65, riderY: 1.18, rotY: Math.PI / 2 },
  monstertruck: { file: "veh_monstertruck.glb", len: 1.60, riderY: 1.28, rotY: Math.PI / 2 },
  rocket:       { file: "veh_rocket.glb",       len: 1.75, riderY: 0.88, rotY: Math.PI / 2 },
  ufo:          { file: "veh_ufo.glb",          len: 1.00, riderY: 0.56, rotY: Math.PI / 2 },
};
Object.values(VEHICLE_MODEL).forEach((v) => useGLTF.preload(modelUrl(v.file)));

// Normalized Meshy vehicle: ground at y=0, centred, scaled to `len` along z.
// Materials are cloned per mount so the paint-shop tint never leaks into the
// shared GLTF cache; tinting multiplies the texture (dark parts stay dark).
function VehicleBody({ file, len, tint, rotY }: { file: string; len: number; tint?: string; rotY: number }) {
  const { scene } = useGLTF(modelUrl(file)) as unknown as { scene: THREE.Object3D };
  const sideways = Math.abs(Math.sin(rotY)) > 0.5; // long axis authored on x
  const norm = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3(); const c = new THREE.Vector3();
    box.getSize(size); box.getCenter(c);
    return { zLen: Math.max(0.0001, sideways ? size.x : size.z), minY: box.min.y, cx: c.x, cz: c.z };
  }, [scene, sideways]);
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    ref.current?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const src = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
      const cloned = Array.isArray(src) ? src.map((m) => m.clone()) : src.clone();
      mesh.material = cloned;
      if (tint) (Array.isArray(cloned) ? cloned : [cloned]).forEach((m) => m.color?.set(tint));
    });
  }, [scene, tint]);
  const s = len / norm.zLen;
  return (
    <group ref={ref} scale={[s, s, s]} position={[0, -norm.minY * s, 0]} rotation={[0, rotY, 0]}>
      <Clone object={scene} position={[-norm.cx, 0, -norm.cz]} />
    </group>
  );
}

const VEHICLE_POSE: Record<string, VehiclePose> = {
  vespa:        { riderY: 1.38, riderZ: 0,     mode: "seated",   rotY: 0,    bar: [1.28, 0.34], lift: 0.082 },
  skateboard:   { riderY: 0.19, riderZ: 0,     mode: "standing", rotY: 0.55, bar: null },
  hoverboard:   { riderY: 0.30, riderZ: 0,     mode: "standing", rotY: 0.55, bar: null, float: true },
  bmx:          { riderY: 0.98, riderZ: -0.08, mode: "seated",   rotY: 0,    bar: [1.14, 0.36] },
  gokart:       { riderY: 0.52, riderZ: -0.16, mode: "seated",   rotY: 0,    bar: [0.80, 0.28], legsFlat: true },
  firetruck:    { riderY: 1.26, riderZ: -0.06, mode: "seated",   rotY: 0,    bar: [1.40, 0.28] },
  monstertruck: { riderY: 1.24, riderZ: 0,     mode: "seated",   rotY: 0,    bar: [1.38, 0.28] },
  rocket:       { riderY: 0.92, riderZ: -0.04, mode: "straddle", rotY: 0,    bar: null, float: true },
  ufo:          { riderY: 0.42, riderZ: 0,     mode: "dome",     rotY: 0,    bar: null, float: true },
};

// Chunky tyre + hub, axle along x. Registers its group so the frame loop can
// spin every wheel of whatever vehicle is equipped.
function ChunkyWheel({ pos, r, w, hub, reg }: { pos: [number, number, number]; r: number; w: number; hub: string; reg: (g: THREE.Group | null) => void }) {
  return (
    <group ref={reg} position={pos}>
      <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r, r, w, 14]} />
        <meshStandardMaterial color="#1c1c20" roughness={0.85} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r * 0.45, r * 0.45, w + 0.015, 10]} />
        <meshStandardMaterial color={hub} metalness={0.7} roughness={0.25} />
      </mesh>
    </group>
  );
}

// A real 3D animal (Quaternius CC0) as the rider body — goat/pig/cow perched
// on whatever vehicle is equipped, saber still in hoof. Height-normalized so
// every species sits the same vs the vehicle; always faces the camera (+z)
// regardless of the pose's stance yaw.
function AnimalBody({ file, pose }: { file: string; pose: VehiclePose }) {
  const { scene } = useGLTF(modelUrl(file)) as unknown as { scene: THREE.Object3D };
  const norm = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const c = new THREE.Vector3(); const size = new THREE.Vector3();
    box.getCenter(c); box.getSize(size);
    return { h: Math.max(0.0001, size.y), minY: box.min.y, cx: c.x, cz: c.z };
  }, [scene]);
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    ref.current?.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }, [scene]);
  const dome = pose.mode === "dome";
  const standing = pose.mode === "standing";
  const H = dome ? 0.62 : standing ? 0.82 : 0.95;  // ~humanoid rider height; smaller on boards so the deck shows
  const s = H / norm.h;
  // Every playable character now has a real GLB (AnimalBody handles ALL
  // riders), so "dome" here means "perched atop the flying saucer's hull" —
  // the Meshy UFO's dome is solid/opaque, not a see-through cockpit bubble,
  // so the rider must clear the top of the disc rather than sink into it.
  const baseY = standing ? -0.42 : dome ? 0.04 : -0.44; // hooves at deck / sunk into seat
  return (
    <group ref={ref} position={[0, baseY, 0]} rotation={[0, -pose.rotY, 0]} scale={[s, s, s]}>
      <Clone object={scene} position={[-norm.cx, -norm.minY, -norm.cz]} />
    </group>
  );
}

// The rider, posed per vehicle. Torso/helmet/saber shared; legs + arms vary.
function Rider({ pose, jacket, helmet, trim, saber, saberGroupRef, saberBladeRef, bladeLen, bladeHalfLen, riderRef, charModel }: {
  pose: VehiclePose; jacket: string; helmet: string; trim: string; saber: SaberInfo;
  saberGroupRef: React.RefObject<THREE.Group | null>; saberBladeRef: React.RefObject<THREE.Mesh | null>;
  bladeLen: number; bladeHalfLen: number; riderRef: React.RefObject<THREE.Group | null>;
  charModel?: string;
}) {
  const seated = pose.mode === "seated";
  const standing = pose.mode === "standing";
  const straddle = pose.mode === "straddle";
  const dome = pose.mode === "dome";
  const legMat = <meshStandardMaterial color="#3a3f58" roughness={0.75} />;
  const bootMat = <meshStandardMaterial color="#191a22" roughness={0.85} />;
  return (
    <group ref={riderRef} position={[0, pose.riderY, pose.riderZ]} rotation={[0, pose.rotY, 0]}>
      {charModel ? <Suspense fallback={null}><AnimalBody file={charModel} pose={pose} /></Suspense> : <>
      {/* Torso */}
      <mesh castShadow position={[0, 0.24, -0.02]} scale={dome ? [1, 0.8, 1] : [1, 1, 1]}>
        <capsuleGeometry args={[0.18, 0.36, 6, 10]} />
        <meshStandardMaterial color={jacket} roughness={0.6} />
      </mesh>
      {/* Helmet + visor */}
      <mesh castShadow position={[0, dome ? 0.54 : 0.62, 0.04]}>
        <sphereGeometry args={[0.22, 12, 10]} />
        <meshStandardMaterial color={helmet} roughness={0.35} metalness={0.25} />
      </mesh>
      <mesh position={[0, dome ? 0.52 : 0.60, 0.20]} rotation={[-0.15, -pose.rotY, 0]} scale={[0.82, 0.46, 0.28]}>
        <sphereGeometry args={[0.28, 10, 8, 0, Math.PI * 2, 0.6, 1.0]} />
        <meshStandardMaterial color="#112233" metalness={0.55} roughness={0.1} transparent opacity={0.82} />
      </mesh>
      {/* Arms + hands */}
      {pose.bar ? (
        <>
          <mesh castShadow position={[-0.22, 0.26, 0.24]} rotation={[-0.6, 0.15, -0.35]}>
            <capsuleGeometry args={[0.065, 0.30, 6, 8]} />
            <meshStandardMaterial color={jacket} roughness={0.6} />
          </mesh>
          <mesh castShadow position={[0.22, 0.26, 0.24]} rotation={[-0.6, -0.15, 0.35]}>
            <capsuleGeometry args={[0.065, 0.30, 6, 8]} />
            <meshStandardMaterial color={jacket} roughness={0.6} />
          </mesh>
          <mesh castShadow position={[-0.33, 0.06, 0.40]}><sphereGeometry args={[0.06, 8, 6]} /><meshStandardMaterial color="#22242e" roughness={0.8} /></mesh>
          <mesh castShadow position={[0.30, 0.10, 0.36]}><sphereGeometry args={[0.06, 8, 6]} /><meshStandardMaterial color="#22242e" roughness={0.8} /></mesh>
        </>
      ) : dome ? null : (
        <>
          {/* Balance arms — out to the sides (boards) or gripping low (rocket) */}
          <mesh castShadow position={[-0.26, 0.30, straddle ? 0.16 : 0.02]} rotation={[straddle ? -0.9 : 0, 0, straddle ? -0.3 : -1.0]}>
            <capsuleGeometry args={[0.065, 0.30, 6, 8]} />
            <meshStandardMaterial color={jacket} roughness={0.6} />
          </mesh>
          <mesh castShadow position={[0.26, 0.30, straddle ? 0.16 : 0.02]} rotation={[straddle ? -0.9 : 0, 0, straddle ? 0.3 : 1.0]}>
            <capsuleGeometry args={[0.065, 0.30, 6, 8]} />
            <meshStandardMaterial color={jacket} roughness={0.6} />
          </mesh>
        </>
      )}
      {/* Legs */}
      {seated && !pose.legsFlat && [-0.11, 0.11].map((lx) => (
        <group key={lx}>
          <mesh castShadow position={[lx, -0.06, 0.14]} rotation={[-1.15, 0, 0]}><capsuleGeometry args={[0.075, 0.26, 6, 8]} />{legMat}</mesh>
          <mesh castShadow position={[lx, -0.32, 0.30]} rotation={[-0.25, 0, 0]}><capsuleGeometry args={[0.06, 0.30, 6, 8]} />{legMat}</mesh>
          <mesh castShadow position={[lx, -0.52, 0.36]} scale={[1, 0.55, 1.7]}><sphereGeometry args={[0.075, 8, 6]} />{bootMat}</mesh>
        </group>
      ))}
      {seated && pose.legsFlat && [-0.11, 0.11].map((lx) => (
        <group key={lx}>
          <mesh castShadow position={[lx, -0.02, 0.22]} rotation={[-1.45, 0, 0]}><capsuleGeometry args={[0.075, 0.30, 6, 8]} />{legMat}</mesh>
          <mesh castShadow position={[lx, -0.06, 0.52]} rotation={[-1.6, 0, 0]}><capsuleGeometry args={[0.06, 0.26, 6, 8]} />{legMat}</mesh>
        </group>
      ))}
      {standing && [-0.10, 0.10].map((lx, li) => (
        <group key={lx} position={[lx, 0, li === 0 ? 0.10 : -0.10]}>
          <mesh castShadow position={[0, -0.16, 0]} rotation={[li === 0 ? 0.12 : -0.12, 0, 0]}><capsuleGeometry args={[0.075, 0.26, 6, 8]} />{legMat}</mesh>
          <mesh castShadow position={[0, -0.44, 0]}><capsuleGeometry args={[0.06, 0.26, 6, 8]} />{legMat}</mesh>
          <mesh castShadow position={[0, -0.60, 0.04]} scale={[1, 0.55, 1.7]}><sphereGeometry args={[0.075, 8, 6]} />{bootMat}</mesh>
        </group>
      ))}
      {straddle && [-0.20, 0.20].map((lx) => (
        <group key={lx}>
          <mesh castShadow position={[lx, -0.08, 0.04]} rotation={[0, 0, lx < 0 ? 0.55 : -0.55]}><capsuleGeometry args={[0.075, 0.24, 6, 8]} />{legMat}</mesh>
          <mesh castShadow position={[lx * 1.35, -0.32, 0.04]}><capsuleGeometry args={[0.06, 0.24, 6, 8]} />{legMat}</mesh>
        </group>
      ))}
      </>}
      {/* Lightsaber — right hand for every pose (tucked to the flank on model riders) */}
      <group ref={saberGroupRef} position={charModel ? [0.30, 0.14, 0.10] : [0.28, 0.30, 0.22]} rotation={[0, 0, -1.1]}>
        <mesh castShadow position={[0, 0.12, 0]}><cylinderGeometry args={[0.03, 0.03, 0.18, 6]} /><meshStandardMaterial color={CHROME_ACCENT} metalness={0.85} roughness={0.2} /></mesh>
        <mesh ref={saberBladeRef} position={[0, bladeHalfLen, 0]}>
          <cylinderGeometry args={[0.025, 0.025, bladeLen, 6]} />
          <meshStandardMaterial color={saber.color} emissive={saber.glow} emissiveIntensity={0.6} />
        </mesh>
      </group>
      {void trim}
    </group>
  );
}

function PlayerVehicle({ stateRef, sizeRef, saber, skin, vehicle, charModel, vehicleColor }: { stateRef: Scene3DProps["stateRef"]; sizeRef: Scene3DProps["sizeRef"]; saber: SaberInfo; skin: SkinInfo; vehicle: string; charModel?: string; vehicleColor?: string }) {
  const group = useRef<THREE.Group>(null);
  const riderGroup = useRef<THREE.Group>(null);
  const saberBlade = useRef<THREE.Mesh>(null);
  const saberGroup = useRef<THREE.Group>(null);
  const exhaustRef = useRef<THREE.Mesh>(null);
  const wheels = useRef<Set<THREE.Group>>(new Set());
  const regWheel = (g: THREE.Group | null) => { if (g) wheels.current.add(g); };

  const bladeLen = useMemo(() => 0.62 + ((saber.reach - 120) / (185 - 120)) * 0.43, [saber.reach]);
  const bladeHalfLen = bladeLen / 2 + 0.16;
  const basePose = VEHICLE_POSE[vehicle] ?? VEHICLE_POSE.vespa;
  const vm = VEHICLE_MODEL[vehicle];
  // Meshy body proportions differ from the procedural builds — override the
  // saddle height (and ground lift) when a model is in play.
  const pose = vm ? { ...basePose, riderY: vm.riderY, lift: vm.lift ?? basePose.lift } : basePose;

  // Authored ~1.9 units tall; played at 0.78 so it sits right vs obstacles.
  const BASE_SCALE = 0.78;

  useEffect(() => { wheels.current.clear(); }, [vehicle]);

  useFrame(() => {
    const st = stateRef.current;
    const { height } = sizeRef.current;
    const roadY = roadYOld(height);
    if (!group.current) return;
    group.current.visible = st.gameRunning;

    let stretchY = 1, stretchX = 1;
    if (st.gameRunning && !st.onGround) {
      stretchY = 1 + Math.max(-0.08, Math.min(0.12, -st.velocity * 0.009));
      stretchX = 1 - (stretchY - 1) * 0.45;
    }
    if (st.landImpact > 0) {
      const k = st.landImpact / 10;
      stretchY = 1 - 0.20 * k;
      stretchX = 1 + 0.20 * k;
    }
    const sliding = st.gameRunning && st.sliding;

    const footY = worldY(st.playerY + FINGER_TIP_OFFSET, roadY);
    const floatBob = pose.float ? 0.06 + Math.sin(st.time * 0.16) * 0.045 : 0;
    group.current.position.set(
      LANE_X + st.laneVisual * LANE_OFFSET,
      footY + (pose.lift ?? 0.02) + floatBob,
      worldZ(FINGER_CENTER_X),
    );
    group.current.scale.set(stretchX * BASE_SCALE, stretchY * BASE_SCALE, stretchX * BASE_SCALE);
    // Negative pitch = nose-down into the screen, matching the travel direction.
    group.current.rotation.x = sliding ? (pose.mode === "standing" ? -0.2 : -0.45) : 0;
    group.current.rotation.z = -st.laneVel * 0.5;
    if (st.shake > 0) group.current.position.x += (Math.random() - 0.5) * st.shake * 0.01;

    const wheelSpin = st.gameRunning ? st.time * 0.28 : 0;
    wheels.current.forEach((w) => { w.rotation.x = wheelSpin; });

    if (riderGroup.current) {
      const bob = st.gameRunning && st.onGround && !pose.float ? Math.sin(st.time * 0.18) * 0.025 : 0;
      riderGroup.current.position.y = pose.riderY + bob;
      // Slide: seated riders tuck forward; standing riders crouch low.
      riderGroup.current.rotation.x = sliding && pose.mode !== "standing" ? -0.35 : 0;
      riderGroup.current.scale.y = sliding && pose.mode === "standing" ? 0.72 : 1;
    }

    if (saberGroup.current) {
      const active = st.saberSwing > 0;
      saberGroup.current.visible = st.gameRunning;
      const progress = active ? 1 - st.saberSwing / SABER_SWING_FRAMES : 0;
      saberGroup.current.rotation.z = active ? -1.4 + progress * 2.6 : -1.1;
      if (saberBlade.current) {
        const mat = saberBlade.current.material as THREE.MeshStandardMaterial;
        mat.color.set(saber.color);
        mat.emissive.set(saber.glow);
        mat.emissiveIntensity = active ? 1.8 : 0.8;
      }
    }
    if (exhaustRef.current) exhaustRef.current.scale.setScalar(0.9 + Math.sin(st.time * 0.4) * 0.15);
  });

  const bodyColor = vehicleColor || skin.backHand;
  const trimColor = skin.finger;
  const hubColor  = skin.knuckle;
  const seatColor = skin.nail;
  const chrome = CHROME_ACCENT;

  return (
    <group ref={group} visible={false}>
      {/* Vehicles are authored front = +z, but the player DRIVES INTO the
          screen (-z). This flip points headlights/handlebars/rider down the
          road, with the rider's back (and butt — fart nozzle) to the camera. */}
      <group rotation={[0, Math.PI, 0]}>
      {/* ── Vehicle body — Meshy AI model when available, else procedural ── */}
      {vm && (
        <Suspense fallback={null}>
          <VehicleBody file={vm.file} len={vm.len} tint={vehicleColor} rotY={vm.rotY} />
        </Suspense>
      )}
      {!vm && vehicle === "skateboard" && (
        <group>
          <mesh castShadow position={[0, 0.13, 0]}><boxGeometry args={[0.30, 0.045, 0.84]} /><meshStandardMaterial color={bodyColor} roughness={0.5} /></mesh>
          <mesh castShadow position={[0, 0.17, 0.44]} rotation={[0.5, 0, 0]}><boxGeometry args={[0.30, 0.04, 0.16]} /><meshStandardMaterial color={trimColor} roughness={0.5} /></mesh>
          <mesh castShadow position={[0, 0.17, -0.44]} rotation={[-0.5, 0, 0]}><boxGeometry args={[0.30, 0.04, 0.16]} /><meshStandardMaterial color={trimColor} roughness={0.5} /></mesh>
          <ChunkyWheel pos={[-0.11, 0.06, 0.30]} r={0.06} w={0.05} hub="#f5a623" reg={regWheel} />
          <ChunkyWheel pos={[0.11, 0.06, 0.30]} r={0.06} w={0.05} hub="#f5a623" reg={regWheel} />
          <ChunkyWheel pos={[-0.11, 0.06, -0.30]} r={0.06} w={0.05} hub="#f5a623" reg={regWheel} />
          <ChunkyWheel pos={[0.11, 0.06, -0.30]} r={0.06} w={0.05} hub="#f5a623" reg={regWheel} />
        </group>
      )}
      {!vm && vehicle === "hoverboard" && (
        <group>
          <mesh castShadow position={[0, 0.20, 0]}><boxGeometry args={[0.34, 0.06, 0.80]} /><meshStandardMaterial color={bodyColor} metalness={0.5} roughness={0.3} /></mesh>
          <mesh position={[0, 0.155, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.30, 0.74]} />
            <meshStandardMaterial color={saber.glow} emissive={saber.glow} emissiveIntensity={1.6} transparent opacity={0.85} side={THREE.DoubleSide} />
          </mesh>
          <mesh castShadow position={[0, 0.22, 0.40]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.05, 0.12, 8]} /><meshStandardMaterial color={chrome} metalness={0.8} roughness={0.15} /></mesh>
          <mesh castShadow position={[0, 0.22, -0.40]} rotation={[-Math.PI / 2, 0, 0]}><coneGeometry args={[0.05, 0.12, 8]} /><meshStandardMaterial color={chrome} metalness={0.8} roughness={0.15} /></mesh>
        </group>
      )}
      {!vm && vehicle === "bmx" && (
        <group>
          <ChunkyWheel pos={[0, 0.30, 0.42]} r={0.30} w={0.06} hub={hubColor} reg={regWheel} />
          <ChunkyWheel pos={[0, 0.30, -0.42]} r={0.30} w={0.06} hub={hubColor} reg={regWheel} />
          <mesh castShadow position={[0, 0.52, 0.06]} rotation={[0.9, 0, 0]}><boxGeometry args={[0.05, 0.06, 0.72]} /><meshStandardMaterial color={bodyColor} roughness={0.4} /></mesh>
          <mesh castShadow position={[0, 0.62, -0.16]} rotation={[-0.6, 0, 0]}><boxGeometry args={[0.05, 0.06, 0.56]} /><meshStandardMaterial color={bodyColor} roughness={0.4} /></mesh>
          <mesh castShadow position={[0, 0.86, -0.30]}><boxGeometry args={[0.05, 0.34, 0.05]} /><meshStandardMaterial color={chrome} metalness={0.8} roughness={0.15} /></mesh>
          <mesh castShadow position={[0, 1.02, -0.30]} scale={[1, 0.5, 1.6]}><sphereGeometry args={[0.11, 8, 6]} /><meshStandardMaterial color={seatColor} roughness={0.8} /></mesh>
          <mesh castShadow position={[0, 0.92, 0.40]} rotation={[0.25, 0, 0]}><boxGeometry args={[0.05, 0.56, 0.05]} /><meshStandardMaterial color={chrome} metalness={0.8} roughness={0.15} /></mesh>
          <mesh castShadow position={[0, 1.18, 0.36]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.03, 0.03, 0.52, 8]} /><meshStandardMaterial color={chrome} metalness={0.85} roughness={0.12} /></mesh>
        </group>
      )}
      {!vm && vehicle === "gokart" && (
        <group>
          <mesh castShadow position={[0, 0.22, 0]}><boxGeometry args={[0.52, 0.10, 0.95]} /><meshStandardMaterial color={bodyColor} roughness={0.4} metalness={0.2} /></mesh>
          <mesh castShadow position={[0, 0.30, 0.44]} rotation={[0.35, 0, 0]}><boxGeometry args={[0.44, 0.16, 0.22]} /><meshStandardMaterial color={trimColor} roughness={0.45} /></mesh>
          <mesh castShadow position={[0, 0.42, -0.34]}><boxGeometry args={[0.40, 0.30, 0.08]} /><meshStandardMaterial color={seatColor} roughness={0.75} /></mesh>
          <mesh castShadow position={[0, 0.62, 0.20]} rotation={[0.5, 0, 0]}><cylinderGeometry args={[0.02, 0.02, 0.30, 6]} /><meshStandardMaterial color="#333" roughness={0.6} /></mesh>
          <mesh castShadow position={[0, 0.74, 0.14]} rotation={[1.1, 0, 0]}><torusGeometry args={[0.10, 0.02, 8, 14]} /><meshStandardMaterial color="#222" roughness={0.6} /></mesh>
          <ChunkyWheel pos={[-0.30, 0.14, 0.36]} r={0.14} w={0.10} hub={hubColor} reg={regWheel} />
          <ChunkyWheel pos={[0.30, 0.14, 0.36]} r={0.14} w={0.10} hub={hubColor} reg={regWheel} />
          <ChunkyWheel pos={[-0.30, 0.18, -0.36]} r={0.18} w={0.12} hub={hubColor} reg={regWheel} />
          <ChunkyWheel pos={[0.30, 0.18, -0.36]} r={0.18} w={0.12} hub={hubColor} reg={regWheel} />
        </group>
      )}
      {!vm && vehicle === "firetruck" && (
        <group>
          <mesh castShadow position={[0, 0.66, -0.06]}><boxGeometry args={[0.70, 0.52, 1.10]} /><meshStandardMaterial color="#d62828" roughness={0.4} metalness={0.15} /></mesh>
          <mesh castShadow position={[0, 0.80, 0.50]} rotation={[0.28, 0, 0]}><boxGeometry args={[0.62, 0.30, 0.10]} /><meshStandardMaterial color="#182838" metalness={0.5} roughness={0.15} /></mesh>
          <mesh position={[0, 0.60, 0]}><boxGeometry args={[0.72, 0.09, 1.12]} /><meshStandardMaterial color="#f4f4f8" roughness={0.5} /></mesh>
          <mesh castShadow position={[0, 0.96, -0.20]}><boxGeometry args={[0.12, 0.05, 0.62]} /><meshStandardMaterial color={chrome} metalness={0.85} roughness={0.15} /></mesh>
          <mesh castShadow position={[-0.18, 0.96, -0.20]}><boxGeometry args={[0.05, 0.05, 0.62]} /><meshStandardMaterial color={chrome} metalness={0.85} roughness={0.15} /></mesh>
          <mesh position={[0, 0.98, 0.30]}><boxGeometry args={[0.30, 0.07, 0.10]} /><meshStandardMaterial color="#ff3030" emissive="#ff2020" emissiveIntensity={1.4} /></mesh>
          <mesh position={[0, 0.98, 0.18]}><boxGeometry args={[0.30, 0.07, 0.10]} /><meshStandardMaterial color="#3060ff" emissive="#2040ff" emissiveIntensity={1.4} /></mesh>
          <ChunkyWheel pos={[-0.34, 0.17, 0.36]} r={0.17} w={0.12} hub={chrome} reg={regWheel} />
          <ChunkyWheel pos={[0.34, 0.17, 0.36]} r={0.17} w={0.12} hub={chrome} reg={regWheel} />
          <ChunkyWheel pos={[-0.34, 0.17, -0.40]} r={0.17} w={0.12} hub={chrome} reg={regWheel} />
          <ChunkyWheel pos={[0.34, 0.17, -0.40]} r={0.17} w={0.12} hub={chrome} reg={regWheel} />
        </group>
      )}
      {!vm && vehicle === "monstertruck" && (
        <group>
          <mesh castShadow position={[0, 1.02, 0]}><boxGeometry args={[0.60, 0.28, 0.92]} /><meshStandardMaterial color={bodyColor} roughness={0.4} metalness={0.2} /></mesh>
          <mesh castShadow position={[0, 1.14, 0.30]} rotation={[0.3, 0, 0]}><boxGeometry args={[0.52, 0.20, 0.08]} /><meshStandardMaterial color="#182838" metalness={0.5} roughness={0.15} /></mesh>
          <mesh position={[0, 0.90, 0]}><boxGeometry args={[0.62, 0.06, 0.94]} /><meshStandardMaterial color={trimColor} roughness={0.5} /></mesh>
          {[[-0.24, 0.36], [0.24, 0.36], [-0.24, -0.36], [0.24, -0.36]].map(([sx, sz], i) => (
            <mesh key={i} castShadow position={[sx, 0.68, sz]} rotation={[0.2 * (i % 2 ? 1 : -1), 0, 0]}>
              <boxGeometry args={[0.05, 0.42, 0.05]} />
              <meshStandardMaterial color={chrome} metalness={0.8} roughness={0.2} />
            </mesh>
          ))}
          <ChunkyWheel pos={[-0.36, 0.34, 0.38]} r={0.34} w={0.22} hub={hubColor} reg={regWheel} />
          <ChunkyWheel pos={[0.36, 0.34, 0.38]} r={0.34} w={0.22} hub={hubColor} reg={regWheel} />
          <ChunkyWheel pos={[-0.36, 0.34, -0.38]} r={0.34} w={0.22} hub={hubColor} reg={regWheel} />
          <ChunkyWheel pos={[0.36, 0.34, -0.38]} r={0.34} w={0.22} hub={hubColor} reg={regWheel} />
        </group>
      )}
      {!vm && vehicle === "rocket" && (
        <group>
          <mesh castShadow position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[0.22, 0.62, 8, 12]} /><meshStandardMaterial color="#e8e8f2" roughness={0.3} metalness={0.4} /></mesh>
          <mesh castShadow position={[0, 0.55, 0.62]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.20, 0.34, 12]} /><meshStandardMaterial color={trimColor} roughness={0.35} metalness={0.3} /></mesh>
          {[0, 2.09, 4.19].map((a, i) => (
            <mesh key={i} castShadow position={[Math.sin(a) * 0.26, 0.55 + Math.cos(a) * 0.26, -0.42]} rotation={[0, 0, -a]}>
              <boxGeometry args={[0.05, 0.26, 0.30]} />
              <meshStandardMaterial color={trimColor} roughness={0.4} />
            </mesh>
          ))}
          <mesh ref={exhaustRef} position={[0, 0.55, -0.66]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.14, 0.42, 10]} />
            <meshStandardMaterial color="#ffb340" emissive="#ff8500" emissiveIntensity={2.2} transparent opacity={0.9} />
          </mesh>
          <mesh position={[0, 0.72, 0.24]}><sphereGeometry args={[0.07, 8, 8]} /><meshStandardMaterial color="#1a3050" metalness={0.5} roughness={0.1} /></mesh>
        </group>
      )}
      {!vm && vehicle === "ufo" && (
        <group>
          <mesh castShadow position={[0, 0.42, 0]} scale={[1, 0.32, 1]}><sphereGeometry args={[0.58, 18, 12]} /><meshStandardMaterial color={chrome} metalness={0.85} roughness={0.15} /></mesh>
          <mesh position={[0, 0.56, 0]}><sphereGeometry args={[0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#9fd8ff" transparent opacity={0.32} metalness={0.3} roughness={0.05} /></mesh>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.44, 0.40, Math.sin(a) * 0.44]}>
                <sphereGeometry args={[0.045, 6, 5]} />
                <meshStandardMaterial color={i % 2 ? "#ffee00" : "#ff44aa"} emissive={i % 2 ? "#ffee00" : "#ff44aa"} emissiveIntensity={1.6} />
              </mesh>
            );
          })}
          <mesh position={[0, 0.20, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.30, 0.30, 14, 1, true]} />
            <meshStandardMaterial color="#7dff8a" emissive="#4dff6a" emissiveIntensity={0.9} transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      )}
      {!vm && vehicle === "vespa" && (
        <group>
          {/* Main body — rounded front shield + step-through frame */}
          <mesh castShadow position={[0, 0.72, 0.08]}>
            <boxGeometry args={[0.54, 0.68, 0.78]} />
            <meshStandardMaterial color={bodyColor} roughness={0.45} metalness={0.18} />
          </mesh>
          <mesh castShadow position={[0, 0.72, 0.46]} rotation={[0.22, 0, 0]} scale={[1, 1, 0.55]}>
            <sphereGeometry args={[0.34, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.72]} />
            <meshStandardMaterial color={bodyColor} roughness={0.4} metalness={0.2} />
          </mesh>
          <mesh castShadow position={[0, 0.84, -0.42]} scale={[0.82, 0.68, 0.72]}>
            <sphereGeometry args={[0.42, 10, 8]} />
            <meshStandardMaterial color={bodyColor} roughness={0.45} metalness={0.18} />
          </mesh>
          <mesh position={[0, 0.62, 0.10]}>
            <boxGeometry args={[0.56, 0.045, 0.82]} />
            <meshStandardMaterial color={chrome} metalness={0.92} roughness={0.08} />
          </mesh>
          <mesh position={[0, 0.98, 0.10]}>
            <boxGeometry args={[0.58, 0.06, 0.72]} />
            <meshStandardMaterial color={trimColor} roughness={0.55} />
          </mesh>
          <mesh castShadow position={[0, 1.22, -0.12]} scale={[0.46, 0.12, 0.56]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={seatColor} roughness={0.8} />
          </mesh>
          <mesh castShadow position={[0, 1.29, -0.12]} scale={[0.45, 0.09, 0.54]}>
            <sphereGeometry args={[1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={seatColor} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.92, 0.52]}>
            <sphereGeometry args={[0.11, 10, 8]} />
            <meshStandardMaterial color="#fffde8" emissive="#ffe8a0" emissiveIntensity={0.9} metalness={0.3} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0.92, 0.50]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.12, 0.025, 8, 14]} />
            <meshStandardMaterial color={chrome} metalness={0.9} roughness={0.1} />
          </mesh>
          <mesh castShadow position={[0, 1.28, 0.34]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.035, 0.035, 0.72, 8]} />
            <meshStandardMaterial color={chrome} metalness={0.88} roughness={0.12} />
          </mesh>
          <mesh castShadow position={[-0.34, 1.28, 0.34]}>
            <cylinderGeometry args={[0.048, 0.044, 0.14, 8]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0.34, 1.28, 0.34]}>
            <cylinderGeometry args={[0.048, 0.044, 0.14, 8]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0.30, 0.32, -0.52]} rotation={[0.3, 0, 0]}>
            <cylinderGeometry args={[0.045, 0.055, 0.44, 8]} />
            <meshStandardMaterial color={chrome} metalness={0.85} roughness={0.15} />
          </mesh>
          <mesh ref={exhaustRef} position={[0.30, 0.30, -0.76]}>
            <sphereGeometry args={[0.08, 6, 5]} />
            <meshStandardMaterial color="#aaaaaa" transparent opacity={0.28} roughness={1} />
          </mesh>
          <group position={[0, 0.26, 0.54]} ref={regWheel}>
            <mesh castShadow rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[0.28, 0.085, 8, 18]} />
              <meshStandardMaterial color="#1c1c1c" roughness={0.85} />
            </mesh>
            {[0, 1, 2, 3].map(i => (
              <mesh key={i} rotation={[i * Math.PI / 4, Math.PI / 2, 0]}>
                <boxGeometry args={[0.012, 0.52, 0.012]} />
                <meshStandardMaterial color={chrome} metalness={0.8} roughness={0.2} />
              </mesh>
            ))}
            <mesh rotation={[0, Math.PI / 2, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.11, 10]} />
              <meshStandardMaterial color={hubColor} metalness={0.7} roughness={0.2} />
            </mesh>
          </group>
          <mesh castShadow position={[0, 0.52, 0.52]} rotation={[0.18, 0, 0]}>
            <boxGeometry args={[0.06, 0.54, 0.06]} />
            <meshStandardMaterial color={chrome} metalness={0.85} roughness={0.15} />
          </mesh>
          <group position={[0, 0.26, -0.56]} ref={regWheel}>
            <mesh castShadow rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[0.28, 0.085, 8, 18]} />
              <meshStandardMaterial color="#1c1c1c" roughness={0.85} />
            </mesh>
            {[0, 1, 2, 3].map(i => (
              <mesh key={i} rotation={[i * Math.PI / 4, Math.PI / 2, 0]}>
                <boxGeometry args={[0.012, 0.52, 0.012]} />
                <meshStandardMaterial color={chrome} metalness={0.8} roughness={0.2} />
              </mesh>
            ))}
            <mesh rotation={[0, Math.PI / 2, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.11, 10]} />
              <meshStandardMaterial color={hubColor} metalness={0.7} roughness={0.2} />
            </mesh>
          </group>
        </group>
      )}

      {/* ── Rider (posed per vehicle) ── */}
      <Rider
        key={`${vehicle}-${charModel ?? "kid"}`}
        pose={pose}
        charModel={charModel}
        jacket={saber.color}
        helmet={bodyColor}
        trim={trimColor}
        saber={saber}
        saberGroupRef={saberGroup}
        saberBladeRef={saberBlade}
        bladeLen={bladeLen}
        bladeHalfLen={bladeHalfLen}
        riderRef={riderGroup}
      />
      </group>
    </group>
  );
}


// ── Ghibli sky dome + drifting painted clouds ──────────────────────────────
// Vertical sky gradient baked into a small canvas texture (CSP-safe, no
// external HDR): a richer zenith fading to a warm, lighter horizon reads far
// less flat than a single flat-colour dome.
function makeSkyGradient(theme: Theme3D): THREE.CanvasTexture {
  const c = THEME_COLORS[theme];
  const dark = theme === "night" || theme === "moon";
  const zenith = new THREE.Color(c.sky).multiplyScalar(dark ? 0.7 : 0.82);
  const horizon = new THREE.Color(c.sky).lerp(new THREE.Color(c.ambient), dark ? 0.35 : 0.6);
  const W = theme === "moon" ? 1024 : 4;
  const H = theme === "moon" ? 512 : 256;
  const cvs = document.createElement("canvas"); cvs.width = W; cvs.height = H;
  const g = cvs.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, `#${zenith.getHexString()}`);
  grad.addColorStop(0.55, `#${new THREE.Color(c.sky).getHexString()}`);
  grad.addColorStop(1, `#${horizon.getHexString()}`);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // Airless lunar sky: prick it with hard white stars (no twinkle blur).
  if (theme === "moon") {
    for (let i = 0; i < 900; i++) {
      const y = Math.random() * H * 0.82; // keep the horizon band mostly clear
      g.globalAlpha = 0.35 + Math.random() * 0.65;
      g.fillStyle = Math.random() < 0.12 ? "#c8d4ff" : "#ffffff";
      const s = Math.random() < 0.12 ? 2 : 1;
      g.fillRect(Math.random() * W, y, s, s);
    }
    g.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function GhibliSky({ theme }: { theme: Theme3D }) {
  const c = THEME_COLORS[theme];
  const skyTex = useMemo(() => makeSkyGradient(theme), [theme]);
  const N_CLOUDS = 8;
  const cloudRefs = useRef<THREE.Group[]>([]);
  const seeds = useMemo(() => Array.from({ length: N_CLOUDS }, (_, i) => ({
    x: (i / N_CLOUDS) * 30 - 15,
    y: 4.0 + (i % 3) * 1.1,
    z: -22 - (i % 4) * 9,
    sx: 0.55 + (i * 0.17 % 0.55),
    sy: 0.28 + (i * 0.09 % 0.22),
    speed: 0.006 + (i % 5) * 0.0025,
    // No clouds on the airless moon; night keeps faint wisps.
    opacity: theme === "moon" ? 0 : theme === "night" ? 0.12 : 0.70 - (i % 3) * 0.10,
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
      {/* Sky dome must fit inside the camera far plane (80) or it clips away
          entirely and the flat background colour shows instead. */}
      <mesh position={[0, -8, -12]} scale={[58, 40, 58]}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial map={skyTex} side={THREE.BackSide} fog={false} toneMapped={false} />
      </mesh>
      {theme === "moon" && (
        // Earth hanging in the black sky — blue marble + white swirl + a
        // whisper of atmosphere glow. The one landmark that sells "you're
        // standing on the moon looking home".
        <group position={[5.5, 7.2, -34]}>
          <mesh>
            <sphereGeometry args={[2.1, 24, 18]} />
            <meshBasicMaterial color="#2f6fd0" fog={false} />
          </mesh>
          <mesh rotation={[0.5, 0.9, 0.3]} scale={[1.004, 1.004, 1.004]}>
            <sphereGeometry args={[2.1, 16, 12, 0, Math.PI * 2, 0.7, 0.75]} />
            <meshBasicMaterial color="#e8f2f8" transparent opacity={0.85} fog={false} />
          </mesh>
          <mesh rotation={[2.2, 0.2, 1.4]} scale={[1.004, 1.004, 1.004]}>
            <sphereGeometry args={[2.1, 16, 12, 0, Math.PI * 2, 1.4, 0.5]} />
            <meshBasicMaterial color="#4a9a58" transparent opacity={0.7} fog={false} />
          </mesh>
          <mesh scale={[1.09, 1.09, 1.09]}>
            <sphereGeometry args={[2.1, 20, 16]} />
            <meshBasicMaterial color="#7db8ff" transparent opacity={0.16} fog={false} />
          </mesh>
        </group>
      )}
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

// ── Italian street — Meshy AI townhouses lining both sides of the road ─────
// Level 1's Tuscan descent: terracotta/ochre/pink facades scroll past close
// to the kerb, facades turned toward the road like a real narrow street.
function ItalyStreet({ stateRef }: { stateRef: Scene3DProps["stateRef"] }) {
  const [b1, b2, b3] = useGLTF([modelUrl("bldg1.glb"), modelUrl("bldg2.glb"), modelUrl("bldg3.glb")]) as { scene: THREE.Object3D }[];
  const T = useMemo(() => {
    const box = new THREE.Box3(); const c = new THREE.Vector3(); const size = new THREE.Vector3();
    const norm = (scene: THREE.Object3D) => {
      box.setFromObject(scene); box.getCenter(c); box.getSize(size);
      return { scene, height: Math.max(0.0001, size.y), minY: box.min.y, cx: c.x, cz: c.z };
    };
    return [norm(b1.scene), norm(b2.scene), norm(b3.scene)];
  }, [b1, b2, b3]);
  const COUNT = 12; const SPACING = 7.2; const SIDE = 4.35;
  const refs = useRef<THREE.Group[]>([]);
  const seeds = useMemo(() => Array.from({ length: COUNT }, (_, i) => ({
    side: (i % 2 === 0 ? -1 : 1) as -1 | 1,
    t: i % 3,
    h: 3.1 + ((i * 7) % 5) * 0.35,
    baseZ: -(Math.floor(i / 2) * SPACING) - (i % 2) * 3.4,
  })), []);
  useFrame(() => {
    const st = stateRef.current;
    const scroll = st.worldScroll * 0.032;
    const range = (COUNT / 2) * SPACING;
    for (let i = 0; i < COUNT; i++) {
      const g = refs.current[i]; if (!g) continue;
      const s = seeds[i];
      let z = s.baseZ + scroll;
      z = ((z % range) + range) % range - range;
      g.position.set(s.side * SIDE, 0, z);
    }
  });
  return (
    <>
      {seeds.map((s, i) => {
        const t = T[s.t]; const sc = s.h / t.height;
        return (
          // Facade (authored facing +z) turned to face the road centre
          <group key={i} ref={(r) => { if (r) refs.current[i] = r; }} rotation={[0, -s.side * Math.PI / 2, 0]}>
            <group scale={[sc, sc, sc]} position={[0, -t.minY * sc, 0]}>
              <Clone object={t.scene} position={[-t.cx, 0, -t.cz]} castShadow receiveShadow />
            </group>
          </group>
        );
      })}
    </>
  );
}
["bldg1.glb", "bldg2.glb", "bldg3.glb"].forEach((f) => useGLTF.preload(modelUrl(f)));

// ── Background scenery — three Ghibli parallax layers ─────────────────────
function ThemeProps({ stateRef, theme }: { stateRef: Scene3DProps["stateRef"]; theme: Theme3D }) {
  const colors = THEME_COLORS[theme];
  // Real CC0 scenery models: two tree species for the leafy themes, a lunar
  // rock for the moon. Normalized (feet at y=0, height 1) then scaled per seed.
  const [tree1G, tree2G, rockG] = useGLTF([modelUrl("tree1.glb"), modelUrl("tree2.glb"), modelUrl("rock.glb")]) as { scene: THREE.Object3D }[];
  const sceneryT = useMemo(() => {
    const box = new THREE.Box3(); const c = new THREE.Vector3(); const size = new THREE.Vector3();
    const norm = (scene: THREE.Object3D) => {
      box.setFromObject(scene); box.getCenter(c); box.getSize(size);
      return { scene, height: Math.max(0.0001, size.y), minY: box.min.y, cx: c.x, cz: c.z };
    };
    return { tree1: norm(tree1G.scene), tree2: norm(tree2G.scene), rock: norm(rockG.scene) };
  }, [tree1G, tree2G, rockG]);
  const SceneryModel = ({ t, targetH }: { t: { scene: THREE.Object3D; height: number; minY: number; cx: number; cz: number }; targetH: number }) => {
    const s = targetH / t.height;
    return (
      <group scale={[s, s, s]} position={[0, -t.minY * s, 0]}>
        <Clone object={t.scene} position={[-t.cx, 0, -t.cz]} castShadow />
      </group>
    );
  };

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
    // Same curve/hill the road uses, so the scenery banks with the turn and
    // rides up/down the hills (distant layers drift more → parallax).
    const curve = st.gameRunning ? roadCurve(st.worldScroll) : 0;
    const hill = st.gameRunning ? roadHill(st.worldScroll) : 0;

    for (let i = 0; i < COUNT_F; i++) {
      const g = farRefs.current[i]; if (!g) continue;
      const s = farSeeds[i];
      const range = COUNT_F * SPACING_F;
      let z = s.baseZ + scroll * 0.38;
      z = ((z % range) + range) % range - range;
      g.position.set(s.side * SIDE_F + curve * 2.4, s.h * 0.4 + hill * 0.9, z - 38);
    }
    for (let i = 0; i < COUNT_M; i++) {
      const g = midRefs.current[i]; if (!g) continue;
      const s = midSeeds[i];
      const range = COUNT_M * SPACING_M;
      let z = s.baseZ + scroll;
      z = ((z % range) + range) % range - range;
      const sway = (theme === "suburb" || theme === "mountain")
        ? Math.sin(t * 0.038 + s.swayPhase) * 0.038 : 0;
      g.position.set(s.side * SIDE_M + sway + curve * 1.3, s.h * 0.5 + hill * 0.5, z);
    }
    for (let i = 0; i < COUNT_N; i++) {
      const g = nearRefs.current[i]; if (!g) continue;
      const s = nearSeeds[i];
      const range = COUNT_N * SPACING_N;
      let z = s.baseZ + scroll;
      z = ((z % range) + range) % range - range;
      const sway = Math.sin(t * 0.075 + i * 1.28) * 0.055;
      g.position.set(s.side * SIDE_N + sway + curve * 0.5, hill * 0.15, z);
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
          {theme === "suburb" && (
            <group position={[0, -s.h * 0.5, 0]}>
              <SceneryModel t={i % 2 === 0 ? sceneryT.tree1 : sceneryT.tree2} targetH={s.h * 1.45} />
            </group>
          )}
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
          {theme === "moon" && (i % 3 === 0 ? (
            // Crater rim — a flattened ring half-sunk into the regolith
            <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1, 0.3]}>
              <torusGeometry args={[s.w * 0.8, s.w * 0.2, 6, 18]} />
              <meshStandardMaterial color={colors.hillMid} roughness={1} flatShading />
            </mesh>
          ) : (
            // Real lunar boulder model, randomly turned
            <group position={[0, -s.h * 0.5, 0]} rotation={[0, i * 2.3, 0]}>
              <SceneryModel t={sceneryT.rock} targetH={s.h * 0.7} />
            </group>
          ))}
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
          {theme === "italy" && (<>
            {/* Terracotta flower pots along the kerb */}
            <mesh castShadow position={[0, s.h * 0.25, 0]}><cylinderGeometry args={[s.h * 0.22, s.h * 0.15, s.h * 0.5, 8]} /><meshStandardMaterial color="#b5654a" roughness={0.85} /></mesh>
            <mesh position={[0, s.h * 0.62, 0]}><sphereGeometry args={[s.h * 0.26, 6, 5]} /><meshBasicMaterial color={i % 2 === 0 ? "#e8506e" : "#3f8f3f"} /></mesh>
          </>)}
          {theme === "city" && <mesh position={[0, s.h * 0.5, 0]}><boxGeometry args={[0.1, s.h, 0.1]} /><meshBasicMaterial color={colors.hillMid} /></mesh>}
          {theme === "highway" && <mesh position={[0, s.h * 0.28, 0]} rotation={[0, i * 0.52, 0]}><cylinderGeometry args={[0.015, s.h * 0.14, s.h * 0.55, 5]} /><meshBasicMaterial color={colors.hillMid} /></mesh>}
          {theme === "mountain" && <mesh position={[0, s.h * 0.5, 0]}><coneGeometry args={[s.h * 0.38, s.h, 5]} /><meshBasicMaterial color={colors.hillMid} /></mesh>}
          {theme === "night" && <mesh position={[0, s.h * 0.62, 0]}><sphereGeometry args={[0.055, 5, 4]} /><meshBasicMaterial color={colors.propAccent} /></mesh>}
          {theme === "moon" && (
            // Half-buried lunar rocks, squashed and randomly turned
            <mesh position={[0, s.h * 0.16, 0]} rotation={[0, i * 1.7, 0]} scale={[1, 0.62, 0.85]} castShadow>
              <sphereGeometry args={[s.h * 0.5, 6, 5]} />
              <meshStandardMaterial color={colors.hillMid} roughness={1} flatShading />
            </mesh>
          )}
        </group>
      ))}
    </>
  );
}

// ── Procedural ground/road textures (canvas → CanvasTexture, CSP-safe) ──────
// Flat colour planes are the biggest "amateur" tell, so give the grass a
// mottled, patchy look and the road a grainy asphalt surface with tyre tracks
// and edge lines. Cheap to generate once and tiled via RepeatWrapping.
function jitterHex(base: string, amt: number): string {
  const c = new THREE.Color(base);
  const j = (v: number) => Math.max(0, Math.min(1, v + (Math.random() - 0.5) * amt));
  c.setRGB(j(c.r), j(c.g), j(c.b));
  return `#${c.getHexString()}`;
}
function makeGrassTexture(theme: Theme3D): THREE.Texture {
  const c = THEME_COLORS[theme];
  const S = 256; const cvs = document.createElement("canvas"); cvs.width = cvs.height = S;
  const g = cvs.getContext("2d")!;
  g.fillStyle = c.shoulder; g.fillRect(0, 0, S, S);
  // soft mottled patches
  for (let i = 0; i < 420; i++) {
    const r = 4 + Math.random() * 22;
    g.globalAlpha = 0.05 + Math.random() * 0.10;
    g.fillStyle = jitterHex(c.shoulder, 0.28);
    g.beginPath(); g.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2); g.fill();
  }
  // fine blade speckle
  g.globalAlpha = 0.5;
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = jitterHex(c.prop, 0.2);
    g.fillRect(Math.random() * S, Math.random() * S, 1, 1 + Math.random() * 2);
  }
  // Lunar regolith: stamp small crater rings (lit rim + shadowed bowl)
  if (theme === "moon") {
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * S, y = Math.random() * S, r = 3 + Math.random() * 9;
      g.globalAlpha = 0.28;
      g.strokeStyle = "#9a9aa4"; g.lineWidth = Math.max(1, r * 0.25);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 0.30;
      g.fillStyle = "#2e2e36";
      g.beginPath(); g.arc(x + r * 0.12, y + r * 0.12, r * 0.62, 0, Math.PI * 2); g.fill();
    }
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
function makeRoadTexture(theme: Theme3D): THREE.Texture {
  const c = THEME_COLORS[theme];
  const W = 128, H = 512; const cvs = document.createElement("canvas"); cvs.width = W; cvs.height = H;
  const g = cvs.getContext("2d")!;
  g.fillStyle = c.road; g.fillRect(0, 0, W, H);
  // asphalt grain
  for (let i = 0; i < 9000; i++) {
    g.globalAlpha = 0.04 + Math.random() * 0.08;
    g.fillStyle = Math.random() < 0.5 ? "#000000" : "#ffffff";
    g.fillRect(Math.random() * W, Math.random() * H, 1, 1);
  }
  // Italian street: cobblestone rings instead of plain asphalt
  if (theme === "italy") {
    for (let y = 7; y < H; y += 13) {
      for (let x = 7; x < W; x += 13) {
        g.globalAlpha = 0.16 + Math.random() * 0.14;
        g.strokeStyle = Math.random() < 0.5 ? "#57504a" : "#948b7e";
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, 4.6 + Math.random() * 1.8, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
  // two darker tyre tracks
  g.globalAlpha = 0.14; g.fillStyle = "#000000";
  g.fillRect(W * 0.24, 0, W * 0.14, H); g.fillRect(W * 0.62, 0, W * 0.14, H);
  // faint edge lines
  g.globalAlpha = 0.5; g.fillStyle = "#e8e6d8";
  g.fillRect(4, 0, 3, H); g.fillRect(W - 7, 0, 3, H);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function GroundAndRoad({ stateRef, theme }: { stateRef: Scene3DProps["stateRef"]; theme: Theme3D }) {
  const colors = THEME_COLORS[theme];
  const dashRefs = useRef<THREE.Mesh[]>([]);
  const grassTex = useMemo(() => makeGrassTexture(theme), [theme]);
  const roadTex = useMemo(() => makeRoadTexture(theme), [theme]);
  // Tiling across the 40×320 grass plane and 3.4×320 road plane.
  grassTex.repeat.set(10, 60);
  roadTex.repeat.set(1, 96);
  const N_DASH = 22; const SPACING = 3.2; const RANGE = N_DASH * SPACING;
  useFrame(() => {
    const st = stateRef.current;
    // Scroll the ground/road textures toward the camera so the surface itself
    // reads as rushing past (not just the dashes).
    grassTex.offset.y = -st.worldScroll * 0.006;
    roadTex.offset.y = -st.worldScroll * 0.0096;
    const curve = st.gameRunning ? roadCurve(st.worldScroll) : 0;
    const hill = st.gameRunning ? roadHill(st.worldScroll) : 0;
    for (let i = 0; i < N_DASH; i++) {
      const m = dashRefs.current[i]; if (!m) continue;
      let z = -(i * SPACING) + st.worldScroll * 0.032;
      z = ((z % RANGE) + RANGE) % RANGE - RANGE;
      const t = Math.min(1, -z / RANGE);
      m.position.set(curve * t * t * 2.6, 0.011 + hill * t * t * 0.9, z);
    }
  });
  return (
    <group>
      <mesh position={[0, -0.02, -140]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 320]} />
        <meshStandardMaterial map={grassTex} color={colors.shoulder} roughness={0.95} metalness={0} />
      </mesh>
      <mesh position={[0, 0, -140]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3.4, 320]} />
        <meshStandardMaterial map={roadTex} color={colors.road} metalness={0.12} roughness={0.72} />
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

// Road undulation signals are kept (used by the lane-marking bend) but the
// camera no longer pans/banks with them — that made the road drift off-centre
// under the fixed 2D rider and felt wonky. The camera stays locked straight
// down the road so the rider is always dead-centre.
export function roadCurve(_scroll: number) { return 0; }
export function roadHill(_scroll: number) { return 0; }

function CameraRig({ stateRef }: { stateRef: Scene3DProps["stateRef"] }) {
  const fovRef = useRef(62);
  useFrame(({ camera }) => {
    const st = stateRef.current;
    const bob = st.gameRunning ? worldYSafe(st) : 0;
    const shakeX = st.shake > 0 ? (Math.random() - 0.5) * st.shake * 0.02 : 0;
    camera.position.set(shakeX, 2.35 + bob * 0.12, 5.4);
    camera.lookAt(0, 1.1 + bob * 0.12, -2.5);
    camera.rotation.z = 0;
    // FOV kick — the modern "sense of speed" trick: the field of view eases
    // wider while the turbo is burning, so the world visibly rushes past,
    // then relaxes back. (Racing-game standard.)
    const targetFov = st.gameRunning && st.boostTimer > 0 ? 71 : 62;
    fovRef.current += (targetFov - fovRef.current) * 0.08;
    const cam = camera as THREE.PerspectiveCamera;
    if (Math.abs(cam.fov - fovRef.current) > 0.01) {
      cam.fov = fovRef.current;
      cam.updateProjectionMatrix();
    }
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
    // Space is black — don't let the character accent tint the lunar sky/fog
    // (18% toward a red saber glow turns a near-black sky visibly red).
    const amt = theme === "moon" ? 0 : 1;
    sky.lerp(acc, 0.18 * amt);
    fog.lerp(acc, 0.12 * amt);
    return { bgColor: sky, fogColor: fog };
  }, [c.sky, c.fog, accent, theme]);
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
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
      />
      {/* Warm fill from opposite side — typical Ghibli cross-lighting */}
      <directionalLight color={c.ambient} intensity={c.sunIntensity * 0.22} position={[-4, 3, -2]} />
      <hemisphereLight color={c.sky} groundColor={c.road} intensity={0.52} />
      {/* Character-tinted neon rim light — uses the active runner's saber-glow
          color so the runner body and road are bathed in their signature hue.
          Apollo runs under blue light, Rocco under green, Santi under amber. */}
      <pointLight color={accent} intensity={0.65} distance={14} decay={2} position={[0, 3, -1.5]} />
      <fog attach="fog" args={[fogColor, 6, theme === "night" ? 38 : theme === "moon" ? 46 : 52]} />
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
// Crash impact FX — a chromatic-aberration pulse that fringes the whole frame
// for a few frames when you eat an obstacle, then settles. Reads as a camera
// "hit" the way modern action games sell impacts.
function CrashAberration({ stateRef }: { stateRef: Scene3DProps["stateRef"] }) {
  // The effect keeps this exact Vector2 instance as its uniform, so mutating
  // it per-frame drives the aberration without touching React. (No ref prop:
  // in React 19 a ref lands in the effect wrapper's props, and the library
  // JSON-stringifies props for memoization — circular-structure crash.)
  const offset = useMemo(() => new THREE.Vector2(0, 0), []);
  useFrame(() => {
    const st = stateRef.current;
    const k = Math.max(0, st.crashFlash) / 28; // 1 → fresh crash, 0 → calm
    const amt = k * k * 0.006;
    offset.set(amt, amt * 0.6);
  });
  return <ChromaticAberration offset={offset} />;
}

function NeonBloom({ theme, stateRef }: { theme: Theme3D; stateRef: Scene3DProps["stateRef"] }) {
  const cfg = BLOOM_CONFIG[theme];
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {/* Screen-space ambient occlusion (N8AO) — soft contact shading in every
          crevice: under the scooter, between obstacle parts, where props meet
          the road. halfRes + performance mode keeps it phone-friendly. */}
      <N8AO halfRes quality="performance" aoRadius={1.1} intensity={2.4} distanceFalloff={1.0} />
      {/* Crisp edge antialiasing — kills the jaggies that read as "cheap". */}
      <SMAA />
      <Bloom
        intensity={cfg.intensity * 1.35}
        luminanceThreshold={cfg.threshold}
        luminanceSmoothing={cfg.smoothing}
        mipmapBlur
        radius={0.72}
      />
      <CrashAberration stateRef={stateRef} />
      {/* Gentle colour grade for a more "produced" look: a touch more contrast
          and saturation so the flat pastels get some richness and pop. */}
      <BrightnessContrast brightness={0.02} contrast={0.12} />
      <HueSaturation saturation={0.16} />
      <Vignette eskil={false} offset={0.2} darkness={0.5} />
    </EffectComposer>
  );
}

// Procedural image-based lighting (no external HDR — CSP-safe). A soft sky
// panel, a warm key "sun", and a cool bounce give every plastic-y primitive
// real highlights and shading, which is the single biggest lift away from the
// flat, amateur look. Rendered once (frames={1}) so it's essentially free.
function EnvLighting({ theme, accent }: { theme: Theme3D; accent: string }) {
  const c = THEME_COLORS[theme];
  return (
    <Environment resolution={128} frames={1} background={false}>
      <Lightformer form="rect" intensity={theme === "night" ? 0.5 : 1.1} color={c.sky}
        scale={[30, 18, 1]} position={[0, 10, -14]} rotation={[Math.PI / 2.4, 0, 0]} />
      <Lightformer form="circle" intensity={theme === "night" ? 1.4 : 3.0} color={c.sun}
        scale={[9, 9, 1]} position={[7, 8, 5]} />
      <Lightformer form="rect" intensity={0.5} color={accent}
        scale={[16, 8, 1]} position={[-8, 3, -3]} rotation={[0, Math.PI / 3, 0]} />
      <Lightformer form="rect" intensity={0.35} color={c.hillMid}
        scale={[24, 24, 1]} position={[0, -6, 0]} rotation={[-Math.PI / 2, 0, 0]} />
    </Environment>
  );
}

export default function Scene3D({ stateRef, sizeRef, theme, saber, skin, accent, vehicle, charModel, vehicleColor, hill = 0 }: Scene3DProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows="soft"
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance", failIfMajorPerformanceCaveat: false }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.12; // a touch brighter/punchier
      }}
      style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}
    >
      <PerspectiveCamera makeDefault position={[0, 2.35, 5.4]} fov={62} near={0.1} far={80} />
      <Lighting theme={theme} accent={accent} />
      <EnvLighting theme={theme} accent={accent} />
      <GhibliSky theme={theme} />
      {theme !== "moon" && <Birds theme={theme} />}
      <CameraRig stateRef={stateRef} />
      {/* Downhill: the player rides the crest at z=0, so pitching the whole
          world group around the origin drops the road away into the distance.
          Positive rotation.x raises the far (-z) edge, so negate the grade. */}
      <group rotation={[-Math.atan(hill), 0, 0]}>
        <GroundAndRoad stateRef={stateRef} theme={theme} />
        {/* Model-driven pieces suspend while their GLBs stream in; the rest of
            the scene renders immediately so first paint stays instant. */}
        <Suspense fallback={null}>
          <ThemeProps stateRef={stateRef} theme={theme} />
          {theme === "italy" && <ItalyStreet stateRef={stateRef} />}
          <ModelObstaclePool stateRef={stateRef} />
        </Suspense>
        <PlayerVehicle stateRef={stateRef} sizeRef={sizeRef} saber={saber} skin={skin} vehicle={vehicle} charModel={charModel} vehicleColor={vehicleColor} />
        <ObstaclePool stateRef={stateRef} sizeRef={sizeRef} />
        <CoinPool stateRef={stateRef} sizeRef={sizeRef} />
        <PowerUpPool stateRef={stateRef} sizeRef={sizeRef} />
        <ParticlePool stateRef={stateRef} sizeRef={sizeRef} />
        <BloodPuddlePool stateRef={stateRef} sizeRef={sizeRef} />
        <PlatformPool stateRef={stateRef} sizeRef={sizeRef} />
        <RopePool stateRef={stateRef} sizeRef={sizeRef} />
      </group>
      <NeonBloom theme={theme} stateRef={stateRef} />
    </Canvas>
  );
}
