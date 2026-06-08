export type FactionId =
  | "caretaker"
  | "corporate"
  | "fanatic"
  | "military"
  | "archaeo"
  | "nanocloud";

export type Behavior =
  | "preserve"
  | "profit"
  | "worship"
  | "strategic"
  | "study"
  | "consume";

export interface FactionDef {
  id: FactionId;
  name: string;
  short: string;
  color: string;
  glow: string;
  behavior: Behavior;
  goal: string;
  desc: string;
  speed: number;
  captureRate: number;
  detect: number;
  dialogue: string[];
}

export interface Vec {
  x: number;
  y: number;
}

export interface Metrics {
  reputation: number;
  mythology: number;
  fear: number;
  value: number;
}

export type EntityKind =
  | "station"
  | "ruin"
  | "resource"
  | "hazard"
  | "event"
  | "gate";

export interface WorldEntity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  r: number;
  faction?: FactionId;
  used?: boolean;
  amount?: number;
  pulse: number;
  label: string;
  eventId?: string;
}

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  baseCost: number;
  max: number;
}

export interface EventChoice {
  text: string;
  outcome: string;
  effects: {
    metrics?: Partial<Metrics>;
    rep?: Partial<Record<FactionId, number>>;
    salvage?: number;
    capture?: number;
    lore?: string;
  };
}

export interface GameEvent {
  id: string;
  title: string;
  body: string;
  faction?: FactionId;
  choices: EventChoice[];
}

export interface LoreEntry {
  id: string;
  title: string;
  text: string;
}

export interface SaveData {
  highScore: number;
  bestSector: number;
  lore: string[];
  runsCompleted: number;
  settings: { muted: boolean };
}
