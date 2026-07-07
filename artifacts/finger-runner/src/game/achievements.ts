// ── Achievement system ────────────────────────────────────────────────────────────────

import { getSave, setSaveValue, getStatValue } from "./saveData";

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  secret?: boolean;
  condition: () => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id:"first_run",   name:"First Steps",      description:"Complete your first level.",         icon:"👣",  condition: () => getStatValue("totalRuns") >= 1 },
  { id:"level_3",     name:"Street Smart",     description:"Unlock level 3.",                    icon:"🎯",  condition: () => getSave().maxLevel >= 3 },
  { id:"level_5",     name:"Highway Hero",     description:"Unlock level 5.",                    icon:"🚗",  condition: () => getSave().maxLevel >= 5 },
  { id:"level_8",     name:"Night Rider",      description:"Unlock level 8.",                    icon:"🌙",  condition: () => getSave().maxLevel >= 8 },
  { id:"all_levels",  name:"Road Warrior",     description:"Complete all 8 levels.",             icon:"🏆",  condition: () => getSave().maxLevel > 8 },
  { id:"collector",   name:"Coin Collector",   description:"Collect 100 coins.",                 icon:"💰",  condition: () => getSave().totalCoins >= 100 },
  { id:"rich",        name:"Millionaire",      description:"Collect 500 coins.",                 icon:"💎",  condition: () => getSave().totalCoins >= 500 },
  { id:"slicer",      name:"Slice 'n Dice",   description:"Slice 10 obstacles.",                icon:"⚔️",  condition: () => getStatValue("totalObstaclesSliced") >= 10 },
  { id:"slicer_50",   name:"Saber Master",     description:"Slice 50 obstacles.",                icon:"👍",  condition: () => getStatValue("totalObstaclesSliced") >= 50 },
  { id:"no_death_3",  name:"Untouchable",      description:"Beat 3 levels without dying.",       icon:"👊",  condition: () => getSave().stats.totalRuns >= 3 && getSave().stats.totalDeaths === 0 },
  { id:"jumper",      name:"Leap of Faith",    description:"Jump 50 times.",                   icon:"🦟",  condition: () => getStatValue("totalJumps") >= 50 },
  { id:"double_jumper",name:"Aerialist",       description:"Double-jump 20 times.",              icon:"🧘",  condition: () => getStatValue("totalDoubleJumps") >= 20 },
  { id:"saber_red",   name:"Apprentice",       description:"Unlock the red lightsaber.",         icon:"🔴",  condition: () => getSave().ownedSabers.includes(1) },
  { id:"saber_orange",name:"Padawan",          description:"Unlock the orange lightsaber.",      icon:"🟠",  condition: () => getSave().ownedSabers.includes(2) },
  { id:"saber_green", name:"Knight",           description:"Unlock the green lightsaber.",       icon:"🟢",  condition: () => getSave().ownedSabers.includes(3) },
  { id:"saber_blue",  name:"Guardian",         description:"Unlock the blue lightsaber.",        icon:"🔵",  condition: () => getSave().ownedSabers.includes(4) },
  { id:"saber_purple",name:"Master",           description:"Unlock the purple lightsaber.",    icon:"🟣",  condition: () => getSave().ownedSabers.includes(5) },
  { id:"endless_1000",name:"Endurance",        description:"Score 1000 in endless mode.",        icon:"⏱️", condition: () => getSave().endlessHighScore >= 1000 },
  { id:"endless_5000",name:"Marathon",         description:"Score 5000 in endless mode.",        icon:"🏃",  condition: () => getSave().endlessHighScore >= 5000 },
  { id:"hat_viking",  name:"Warrior Spirit",   description:"Equip the viking helmet.",           icon:"⚔️",  condition: () => getSave().equippedHat === "viking" },
  { id:"hat_crown",   name:"Royalty",          description:"Equip the gold crown.",              icon:"👑",  condition: () => getSave().equippedHat === "crown" },
  { id:"playtime_10", name:"Committed",        description:"Play for 10 minutes total.",         icon:"⏰",  condition: () => getSave().stats.playTimeSeconds >= 600 },
  { id:"playtime_30", name:"Dedicated",        description:"Play for 30 minutes total.",         icon:"👒",  condition: () => getSave().stats.playTimeSeconds >= 1800 },
  { id:"hat_all",     name:"Fashionista",      description:"Own every hat.",                     icon:"👗",  condition: () => getSave().ownedHats.length >= 6 },
];

export function checkAchievements(): string[] {
  const save = getSave();
  const newlyUnlocked: string[] = [];
  for (const ach of ACHIEVEMENTS) {
    if (!save.achievements[ach.id] && ach.condition()) {
      save.achievements[ach.id] = true;
      newlyUnlocked.push(ach.id);
    }
  }
  if (newlyUnlocked.length > 0) {
    setSaveValue("achievements", save.achievements);
  }
  return newlyUnlocked;
}

export function isAchievementUnlocked(id: string): boolean {
  return !!getSave().achievements[id];
}

export function getAchievementDef(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find(a => a.id === id);
}

export function getUnlockedCount(): number {
  const save = getSave();
  return ACHIEVEMENTS.filter(a => save.achievements[a.id]).length;
}

export function getTotalCount(): number {
  return ACHIEVEMENTS.length;
}
