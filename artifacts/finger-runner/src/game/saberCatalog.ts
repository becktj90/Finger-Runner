// ── Saber catalog with permanent unlocks & selection ──────────────────────────────

import { getSave, setSaveValue, getSaveValue } from "./saveData";

export interface SaberDef {
  tier: number;
  name: string;
  color: string;
  glow: string;
  reach: number;
  cost: number;
  description: string;
}

export const SABER_CATALOG: SaberDef[] = [
  { tier:1, name:"Red Saber",    color:"#ff2b2b", glow:"#ff6b6b", reach:120, cost:0,   description:"The apprentice blade. Reliable and fierce." },
  { tier:2, name:"Orange Saber", color:"#ff9500", glow:"#ffbe5c", reach:135, cost:60,  description:"A warrior's edge. Longer reach." },
  { tier:3, name:"Green Saber",  color:"#34ff5e", glow:"#86ff9e", reach:150, cost:130, description:"A guardian's weapon. Swift and bright." },
  { tier:4, name:"Blue Saber",   color:"#36b8ff", glow:"#8fd9ff", reach:165, cost:230, description:"A master's blade. Vast reach." },
  { tier:5, name:"Purple Saber", color:"#b14bff", glow:"#d49bff", reach:185, cost:380, description:"The legendary saber. Unmatched power." },
];

export function getSaberByTier(tier: number): SaberDef {
  return SABER_CATALOG[Math.max(0, Math.min(SABER_CATALOG.length - 1, tier - 1))];
}

export function getEquippedSaber(): SaberDef {
  const save = getSave();
  return getSaberByTier(save.equippedSaber || save.saberLevel || 1);
}

export function getOwnedSabers(): number[] {
  return getSave().ownedSabers || [1];
}

export function isSaberOwned(tier: number): boolean {
  return getOwnedSabers().includes(tier);
}

export function isSaberEquipped(tier: number): boolean {
  return (getSave().equippedSaber || getSave().saberLevel || 1) === tier;
}

export function canAffordSaber(tier: number): boolean {
  const saber = getSaberByTier(tier);
  return getSave().totalCoins >= saber.cost;
}

export function getNextUnlockableSaber(): SaberDef | null {
  const owned = getOwnedSabers();
  const nextTier = Math.max(...owned) + 1;
  if (nextTier > SABER_CATALOG.length) return null;
  return getSaberByTier(nextTier);
}

export function buySaber(tier: number): boolean {
  const save = getSave();
  const saber = getSaberByTier(tier);
  if (save.ownedSabers.includes(tier)) return true; // already owned
  if (save.totalCoins < saber.cost) return false; // can't afford
  save.totalCoins -= saber.cost;
  save.ownedSabers.push(tier);
  save.equippedSaber = tier;
  setSaveValue("totalCoins", save.totalCoins);
  setSaveValue("ownedSabers", save.ownedSabers);
  setSaveValue("equippedSaber", save.equippedSaber);
  return true;
}

export function equipSaber(tier: number): boolean {
  const save = getSave();
  if (!save.ownedSabers.includes(tier)) return false;
  save.equippedSaber = tier;
  setSaveValue("equippedSaber", tier);
  return true;
}
