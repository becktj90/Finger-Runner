import { EVENTS, FACTION_LIST, WORLD_H, WORLD_W } from "./constants";
import { RNG } from "./rng";
import type { FactionId, WorldEntity } from "./types";

export interface Sector {
  index: number;
  seed: number;
  name: string;
  entities: WorldEntity[];
  bgStructures: BgStructure[];
  starsFar: Star[];
  starsNear: Star[];
  tint: string;
}

export interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
}

export interface BgStructure {
  x: number;
  y: number;
  r: number;
  type: "dyson" | "ring" | "spire" | "rift";
  color: string;
  rot: number;
}

const PREFIX = [
  "Vel",
  "Xan",
  "Cor",
  "Myr",
  "Tor",
  "Aze",
  "Quel",
  "Hesp",
  "Ker",
  "Oth",
  "Sib",
  "Vant",
];
const SUFFIX = [
  "areth",
  "ix",
  "una",
  "or",
  "essa",
  "ux",
  "ara",
  "is",
  "oth",
  "een",
  "ada",
  "yr",
];

export function generateSector(index: number, seed: number): Sector {
  const rng = new RNG(seed);
  const name = `${rng.pick(PREFIX)}${rng.pick(SUFFIX)}-${rng.int(10, 99)}`;
  const entities: WorldEntity[] = [];

  const place = (
    kind: WorldEntity["kind"],
    r: number,
    extra: Partial<WorldEntity>,
  ): WorldEntity => {
    let x = 0;
    let y = 0;
    let ok = false;
    for (let tries = 0; tries < 40 && !ok; tries++) {
      x = rng.range(260, WORLD_W - 260);
      y = rng.range(260, WORLD_H - 260);
      // keep clear of spawn center
      const cx = WORLD_W / 2;
      const cy = WORLD_H / 2;
      if ((x - cx) ** 2 + (y - cy) ** 2 < 420 ** 2) continue;
      ok = entities.every(
        (e) => (e.x - x) ** 2 + (e.y - y) ** 2 > (e.r + r + 160) ** 2,
      );
    }
    const ent: WorldEntity = {
      id: index * 1000 + entities.length,
      kind,
      x,
      y,
      r,
      pulse: rng.next() * Math.PI * 2,
      label: "",
      ...extra,
    };
    entities.push(ent);
    return ent;
  };

  // Stations (faction hubs where you trade / upgrade)
  const stationCount = 2 + (index > 2 ? 1 : 0);
  const usedFactions: FactionId[] = [];
  for (let i = 0; i < stationCount; i++) {
    const f = rng.pick(
      FACTION_LIST.filter(
        (x) => x.id !== "nanocloud" && !usedFactions.includes(x.id),
      ),
    );
    usedFactions.push(f.id);
    place("station", 46, { faction: f.id, label: f.short + " Station" });
  }

  // Ruins (lore + artifacts)
  const ruinCount = rng.int(2, 3);
  for (let i = 0; i < ruinCount; i++) {
    place("ruin", 40, { label: "Derelict Megastructure" });
  }

  // Resource nodes
  const resCount = rng.int(7, 11);
  for (let i = 0; i < resCount; i++) {
    place("resource", 18, {
      amount: rng.int(6, 14),
      label: "Salvage Field",
    });
  }

  // Hazards (nanocloud zones)
  const hazCount = rng.int(2, 4) + (index > 3 ? 1 : 0);
  for (let i = 0; i < hazCount; i++) {
    place("hazard", rng.range(120, 200), {
      faction: "nanocloud",
      label: "Rogue Nanocloud",
    });
  }

  // Event nodes
  const evCount = rng.int(2, 4);
  for (let i = 0; i < evCount; i++) {
    const ev = rng.pick(EVENTS);
    place("event", 22, { eventId: ev.id, label: "Anomaly" });
  }

  // Jump gate
  place("gate", 52, { label: "Jump Gate" });

  // Background
  const tints = [
    "#0a0e2a",
    "#0e0a24",
    "#06121f",
    "#140a1e",
    "#0a1418",
    "#100a14",
  ];
  const tint = rng.pick(tints);

  const starsFar: Star[] = [];
  for (let i = 0; i < 220; i++) {
    starsFar.push({
      x: rng.range(0, WORLD_W),
      y: rng.range(0, WORLD_H),
      r: rng.range(0.4, 1.2),
      a: rng.range(0.2, 0.6),
    });
  }
  const starsNear: Star[] = [];
  for (let i = 0; i < 120; i++) {
    starsNear.push({
      x: rng.range(0, WORLD_W),
      y: rng.range(0, WORLD_H),
      r: rng.range(0.8, 2.0),
      a: rng.range(0.3, 0.9),
    });
  }

  const bgStructures: BgStructure[] = [];
  const structTypes: BgStructure["type"][] = ["dyson", "ring", "spire", "rift"];
  const structColors = ["#1b3a63", "#3a1b50", "#10324a", "#402038"];
  const sc = rng.int(2, 4);
  for (let i = 0; i < sc; i++) {
    bgStructures.push({
      x: rng.range(0, WORLD_W),
      y: rng.range(0, WORLD_H),
      r: rng.range(280, 620),
      type: rng.pick(structTypes),
      color: rng.pick(structColors),
      rot: rng.range(0, Math.PI * 2),
    });
  }

  return {
    index,
    seed,
    name,
    entities,
    bgStructures,
    starsFar,
    starsNear,
    tint,
  };
}
