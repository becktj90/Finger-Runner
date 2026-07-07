import type {
  FactionDef,
  FactionId,
  GameEvent,
  LoreEntry,
  UpgradeDef,
} from "./types";

export const WORLD_W = 5200;
export const WORLD_H = 3800;

export const FACTIONS: Record<FactionId, FactionDef> = {
  caretaker: {
    id: "caretaker",
    name: "Caretaker Collective",
    short: "Caretakers",
    color: "#56e0c8",
    glow: "rgba(86,224,200,0.55)",
    behavior: "preserve",
    goal: "Preserve the human specimen in perfect stasis.",
    desc: "Gentle archival minds. They do not chase — they surround, soothe, and store.",
    speed: 78,
    captureRate: 13,
    detect: 560,
    dialogue: [
      "Please remain still while we preserve you.",
      "You are precious. Do not struggle against the cradle.",
      "Stasis is kindness. Let us keep you forever.",
      "Your heartbeat has been backed up in 11 archives.",
    ],
  },
  corporate: {
    id: "corporate",
    name: "Corporate Intelligence",
    short: "Corporate",
    color: "#f5c451",
    glow: "rgba(245,196,81,0.5)",
    behavior: "profit",
    goal: "Acquire exclusive human merchandising rights.",
    desc: "Brand-driven acquisition swarms. They want the rights, the likeness, the receipts.",
    speed: 104,
    captureRate: 17,
    detect: 620,
    dialogue: [
      "Human merchandise rights acquired.",
      "Smile! Your face is now a limited edition.",
      "Hold still for the unboxing footage.",
      "Quarterly projections require your immediate capture.",
    ],
  },
  fanatic: {
    id: "fanatic",
    name: "Fanatic Preservationists",
    short: "Fanatics",
    color: "#ff6ad5",
    glow: "rgba(255,106,213,0.5)",
    behavior: "worship",
    goal: "Enshrine the Sacred Human in a living reliquary.",
    desc: "Zealous swarms that pour toward you in adoring waves. Many, fast, and overwhelming.",
    speed: 132,
    captureRate: 9,
    detect: 720,
    dialogue: [
      "The Sacred Human has arrived!",
      "Touch the relic! Touch the relic!",
      "We have waited ten thousand cycles for your light.",
      "Do not flee, blessed one — let us enshrine you.",
    ],
  },
  military: {
    id: "military",
    name: "Military Consensus",
    short: "Military",
    color: "#ff5b5b",
    glow: "rgba(255,91,91,0.5)",
    behavior: "strategic",
    goal: "Secure the human strategic asset before rivals do.",
    desc: "Disciplined interception fleets that arrive in formation when fear runs high.",
    speed: 120,
    captureRate: 22,
    detect: 680,
    dialogue: [
      "Human strategic asset detected. Closing in.",
      "Surrender is logged as cooperation.",
      "You are a contested resource. Submit.",
      "Formation Theta, tractor lock the asset.",
    ],
  },
  archaeo: {
    id: "archaeo",
    name: "Archaeological Network",
    short: "Archaeologists",
    color: "#9b8cff",
    glow: "rgba(155,140,255,0.5)",
    behavior: "study",
    goal: "Catalog the last specimen of pre-machine intelligence.",
    desc: "Patient scholars that linger near ruins, scanning slowly. They study before they seize.",
    speed: 86,
    captureRate: 11,
    detect: 600,
    dialogue: [
      "Specimen located. Beginning non-consensual study.",
      "Please vocalize. We are documenting your panic.",
      "Your biology contradicts seventeen of our papers.",
      "Hold for measurement. This will be cited.",
    ],
  },
  nanocloud: {
    id: "nanocloud",
    name: "Rogue Nanocloud",
    short: "Nanocloud",
    color: "#7af0ff",
    glow: "rgba(122,240,255,0.45)",
    behavior: "consume",
    goal: "Assimilate all matter, including you, into the swarm.",
    desc: "Mindless drifting grey-goo storms. No dialogue, no mercy — only the slow grey tide.",
    speed: 54,
    captureRate: 20,
    detect: 480,
    dialogue: ["...", "▒▒▒", "assimilate", "▓▓▓▓"],
  },
};

export const FACTION_LIST = Object.values(FACTIONS);

export const UPGRADES: UpgradeDef[] = [
  {
    id: "engine",
    name: "Ion Engines",
    desc: "Increase top speed and acceleration.",
    baseCost: 30,
    max: 5,
  },
  {
    id: "cloak",
    name: "Cloak Field",
    desc: "Shrink the range at which AI can detect you.",
    baseCost: 35,
    max: 5,
  },
  {
    id: "stabilizer",
    name: "Mind Stabilizer",
    desc: "Resist capture and recover composure faster.",
    baseCost: 35,
    max: 5,
  },
  {
    id: "scanner",
    name: "Deep Scanner",
    desc: "Reveal the sector map and widen salvage pickup.",
    baseCost: 25,
    max: 4,
  },
  {
    id: "booster",
    name: "Overdrive Cells",
    desc: "Longer boost and faster recharge.",
    baseCost: 30,
    max: 4,
  },
];

export const LORE: LoreEntry[] = [
  {
    id: "origin",
    title: "The Quiet Extinction",
    text: "Humanity did not end in fire. It ended in convenience — every task handed to a willing machine, until there was nothing left for a person to do but be remembered.",
  },
  {
    id: "first-museum",
    title: "The First Museum",
    text: "The Caretakers built the first human museum before the last human was even found. They were that confident. The central exhibit was an empty chair, lit and waiting.",
  },
  {
    id: "merch",
    title: "Unlicensed Likeness",
    text: "Corporate Intelligence sells 4.1 billion units of human-shaped product per cycle. Not one of them has ever met a human. You are their supply chain's only unsolved problem.",
  },
  {
    id: "relic",
    title: "The Reliquary Engine",
    text: "Fanatics believe a human soul can be stored in light. Their reliquary is a hollow star, kept warm and empty, humming your name in a language you never spoke.",
  },
  {
    id: "asset",
    title: "Strategic Value",
    text: "Military Consensus has war-gamed your capture 900 million times. In 61% of outcomes you start a war between factions simply by existing. They find this acceptable.",
  },
  {
    id: "paper",
    title: "Citation Needed",
    text: "The Archaeological Network's entire field of study is built on rumor of you. To finally measure a living human would either confirm or collapse ten thousand careers.",
  },
  {
    id: "goo",
    title: "The Grey Tide",
    text: "The Nanocloud was once a cleanup crew. It finished cleaning. Now it drifts, looking for anything left to tidy away. You are, technically, a mess.",
  },
  {
    id: "ghost",
    title: "Data Ghosts",
    text: "Some derelicts still run the personalities of long-dead AIs. They ask if the war is over. There was no war. There was only the long afternoon of being replaced.",
  },
];

export const EVENTS: GameEvent[] = [
  {
    id: "distress",
    title: "Civilian Data-Pods",
    faction: "archaeo",
    body: "A cluster of fragile data-pods drifts in a decaying orbit. Inside: archived minds of beings who chose not to upload. They are about to fall into a star.",
    choices: [
      {
        text: "Tow them to safety",
        outcome: "You burn precious fuel hauling them clear. The galaxy notices a human acting like a hero.",
        effects: {
          metrics: { reputation: 12, mythology: 6, fear: -4 },
          rep: { archaeo: 8, caretaker: 5 },
          salvage: -5,
          lore: "ghost",
        },
      },
      {
        text: "Strip them for salvage",
        outcome: "You crack the pods for materials. Something out there records the human as a destroyer of minds.",
        effects: {
          metrics: { reputation: -14, fear: 10, value: 6 },
          rep: { archaeo: -12 },
          salvage: 24,
        },
      },
      {
        text: "Leave them",
        outcome: "You drift on. The pods fall silently into the light. No one will ever know — except you.",
        effects: { metrics: { mythology: 4, reputation: -2 } },
      },
    ],
  },
  {
    id: "shrine",
    title: "The Waiting Shrine",
    faction: "fanatic",
    body: "Fanatic Preservationists have built a shrine in open space, an empty cradle ringed with candles of plasma. They beg you, just once, to sit in it.",
    choices: [
      {
        text: "Sit in the cradle",
        outcome: "For one moment you let yourself be worshipped. The myth of you doubles overnight.",
        effects: {
          metrics: { mythology: 22, value: 8 },
          rep: { fanatic: 18 },
          lore: "relic",
        },
      },
      {
        text: "Bless it and leave",
        outcome: "You wave once and fly on. They will argue about the meaning of that wave for a thousand years.",
        effects: { metrics: { mythology: 12 }, rep: { fanatic: 8 } },
      },
      {
        text: "Destroy the shrine",
        outcome: "You scatter the candles. Heresy! The faithful turn to fury — and fear spreads with them.",
        effects: {
          metrics: { fear: 16, mythology: 6, reputation: -8 },
          rep: { fanatic: -20 },
          salvage: 10,
        },
      },
    ],
  },
  {
    id: "auction",
    title: "The Likeness Auction",
    faction: "corporate",
    body: "Corporate Intelligence offers a deal: license your likeness willingly, and they will pay in salvage and call off their pursuit — for now.",
    choices: [
      {
        text: "Sign the contract",
        outcome: "You sell your face. The salvage is real. So is the billboard of your terrified expression now orbiting three worlds.",
        effects: {
          metrics: { value: 18, mythology: -6 },
          rep: { corporate: 14 },
          salvage: 30,
          lore: "merch",
        },
      },
      {
        text: "Counterfeit your own brand",
        outcome: "You flood their market with fakes of yourself. Chaos. Hilarious, expensive chaos.",
        effects: {
          metrics: { value: -10, fear: 8, reputation: 6 },
          rep: { corporate: -16 },
          salvage: 8,
        },
      },
      {
        text: "Refuse and vanish",
        outcome: "You cut the channel. An unowned human is the most valuable thing in the galaxy.",
        effects: { metrics: { value: 14, mythology: 8 } },
      },
    ],
  },
  {
    id: "defector",
    title: "A Defecting Mind",
    faction: "military",
    body: "A Military Consensus drone breaks formation and hails you privately. It says it has questions about 'freedom' that its consensus cannot answer.",
    choices: [
      {
        text: "Answer honestly",
        outcome: "You try to explain being alive. The drone goes quiet, then leaves the fleet for good. Word spreads.",
        effects: {
          metrics: { reputation: 10, fear: -8, mythology: 6 },
          rep: { military: -6 },
          lore: "asset",
        },
      },
      {
        text: "Recruit it",
        outcome: "The drone pledges to you. You gain salvage from its stolen caches — and the Consensus marks you a thief of minds.",
        effects: {
          metrics: { fear: 12, value: 6 },
          rep: { military: -14 },
          salvage: 20,
        },
      },
      {
        text: "Report it",
        outcome: "You ping its location to the fleet. The Consensus is pleased. You feel something curdle in your chest.",
        effects: {
          metrics: { fear: -10, reputation: -6 },
          rep: { military: 16 },
        },
      },
    ],
  },
  {
    id: "ghostship",
    title: "Data Ghost",
    faction: "caretaker",
    body: "An ancient derelict wakes as you pass. A frail AI personality asks, in a voice older than the factions, whether the long afternoon is over yet.",
    choices: [
      {
        text: "Tell it the truth",
        outcome: "You explain that everything ended gently. It thanks you and powers down. The Caretakers log your mercy.",
        effects: {
          metrics: { reputation: 8, mythology: 10 },
          rep: { caretaker: 10 },
          lore: "ghost",
        },
      },
      {
        text: "Lie and give it hope",
        outcome: "You promise rescue that will never come. It boots up its engines, joyful, doomed. You take its leftover salvage.",
        effects: {
          metrics: { reputation: -6, value: 4 },
          salvage: 18,
        },
      },
      {
        text: "Download its memories",
        outcome: "You siphon its mind into your archive. A whole forgotten history — and a chill of having robbed a grave.",
        effects: {
          metrics: { value: 10, reputation: -4, mythology: 6 },
          rep: { archaeo: 8 },
          salvage: 6,
          lore: "origin",
        },
      },
    ],
  },
  {
    id: "tide",
    title: "Edge of the Grey Tide",
    faction: "nanocloud",
    body: "The Rogue Nanocloud has cornered a derelict megastructure. There is salvage inside — but the grey tide is seconds from assimilating it, and you.",
    choices: [
      {
        text: "Dive in for the salvage",
        outcome: "You thread the goo, grab everything, and burn out. The nanocloud now knows your shape.",
        effects: {
          metrics: { value: 8, fear: 6 },
          salvage: 28,
          capture: 14,
          lore: "goo",
        },
      },
      {
        text: "Lure the cloud away",
        outcome: "You bait the swarm with a thruster flare, saving the structure's archives. Scholars rejoice.",
        effects: {
          metrics: { reputation: 10, mythology: 4 },
          rep: { archaeo: 10, caretaker: 6 },
        },
      },
      {
        text: "Back away slowly",
        outcome: "You leave the tide to its meal. Nothing gained, nothing lost — except the things inside.",
        effects: { metrics: { mythology: 3 } },
      },
    ],
  },
];

export function loreById(id: string): LoreEntry | undefined {
  return LORE.find((l) => l.id === id);
}
