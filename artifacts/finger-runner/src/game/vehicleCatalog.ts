// ── Vehicle catalogue — rides the runner unlocks and upgrades to ─────────────
// Replaces the old hat/outfit system (hats never actually rendered — the 3D
// rider that wore them is hidden; vehicles are drawn by the 2D canvas rider).
// Level vehicles unlock automatically at unlockLevel; coin vehicles use
// unlockLevel:0 + a cost and are gated on purchase (stored in ownedVehicles).

export type VehicleId =
  | "vespa" | "skateboard" | "bmx" | "gokart" | "firetruck" | "monstertruck"
  | "hoverboard" | "rocket" | "ufo";

export interface VehicleDef {
  id: VehicleId;
  name: string;
  emoji: string;
  unlockLevel: number;
  cost?: number;
  blurb: string;
}

export const VEHICLES: VehicleDef[] = [
  { id: "vespa",        name: "Vespa Scooter",  emoji: "🛵", unlockLevel: 0, blurb: "The trusty original" },
  { id: "skateboard",   name: "Skateboard",     emoji: "🛹", unlockLevel: 2, blurb: "Kick, push, coast!" },
  { id: "bmx",          name: "BMX Bike",       emoji: "🚲", unlockLevel: 3, blurb: "Pedal power" },
  { id: "gokart",       name: "Go-Kart",        emoji: "🏎️", unlockLevel: 5, blurb: "Low and fast" },
  { id: "firetruck",    name: "Fire Truck",     emoji: "🚒", unlockLevel: 6, blurb: "WEE-OO WEE-OO!" },
  { id: "monstertruck", name: "Monster Truck",  emoji: "🚙", unlockLevel: 8, blurb: "HUGE wheels" },
  // Coin-purchasable rides (unlockLevel:0, gated on purchase)
  { id: "hoverboard",   name: "Hoverboard",     emoji: "🛸", unlockLevel: 0, cost: 60,  blurb: "No wheels needed" },
  { id: "rocket",       name: "Rocket",         emoji: "🚀", unlockLevel: 0, cost: 250, blurb: "3... 2... 1... BLAST OFF" },
  { id: "ufo",          name: "UFO",            emoji: "👽", unlockLevel: 0, cost: 400, blurb: "Out of this world" },
];

export function getVehicleDef(id: string): VehicleDef {
  for (let i = 0; i < VEHICLES.length; i++) if (VEHICLES[i].id === id) return VEHICLES[i];
  return VEHICLES[0];
}

// A vehicle is available if it's a level unlock the player has reached, or a
// coin ride they've purchased.
export function isVehicleUnlocked(
  v: { id: VehicleId; unlockLevel: number; cost?: number },
  owned: string[],
  maxLevel: number,
): boolean {
  if (v.cost == null) return v.unlockLevel <= maxLevel;
  return owned.includes(v.id);
}
