// ── Tabbed wardrobe: outfits, sabers, achievements, stats ───────────────────

import { useState, useEffect } from "react";
import {
  getSaberByTier, getOwnedSabers, isSaberEquipped, isSaberOwned,
  getNextUnlockableSaber, buySaber, equipSaber,
  ACHIEVEMENTS, isAchievementUnlocked, getUnlockedCount, getTotalCount,
  getStatValue, getSaveValue, getEndlessHighScore, getEndlessBestDistance,
  fetchSyncCode, adoptSyncCode,
} from "../game";

type HatId = "none"|"tophat"|"cap"|"crown"|"cowboy"|"viking"|"beanie"|"party"|"wizard"|"propeller"|"halo";

interface HatDef { id: HatId; name: string; emoji: string; unlockLevel: number; cost?: number }

const HATS: HatDef[] = [
  { id: "none",   name: "Bare Knuckle",  emoji: "🤚", unlockLevel: 0 },
  { id: "tophat", name: "Top Hat",       emoji: "🎩", unlockLevel: 2 },
  { id: "cap",    name: "Baseball Cap",  emoji: "🧢", unlockLevel: 3 },
  { id: "crown",  name: "Gold Crown",    emoji: "👑", unlockLevel: 5 },
  { id: "cowboy", name: "Cowboy Hat",    emoji: "🤠", unlockLevel: 6 },
  { id: "viking", name: "Viking Helmet", emoji: "⚔️", unlockLevel: 8 },
  { id: "beanie",    name: "Cozy Beanie",   emoji: "🧵", unlockLevel: 0, cost: 25 },
  { id: "party",     name: "Party Hat",     emoji: "🎉", unlockLevel: 0, cost: 50 },
  { id: "wizard",    name: "Wizard Hat",    emoji: "🧙", unlockLevel: 0, cost: 90 },
  { id: "propeller", name: "Propeller Cap", emoji: "🚁", unlockLevel: 0, cost: 140 },
  { id: "halo",      name: "Angel Halo",    emoji: "😇", unlockLevel: 0, cost: 200 },
];

const SABERS = [
  { tier: 1, name: "Red Saber",    color: "#ff2b2b", glow: "#ff6b6b", reach: 120, cost: 0 },
  { tier: 2, name: "Orange Saber", color: "#ff9500", glow: "#ffbe5c", reach: 135, cost: 60 },
  { tier: 3, name: "Green Saber",  color: "#34ff5e", glow: "#86ff9e", reach: 150, cost: 130 },
  { tier: 4, name: "Blue Saber",   color: "#36b8ff", glow: "#8fd9ff", reach: 165, cost: 230 },
  { tier: 5, name: "Purple Saber", color: "#b14bff", glow: "#d49bff", reach: 185, cost: 380 },
];

const font = "'Courier New', monospace";
const retroFont = "'Press Start 2P', monospace";

function isHatUnlocked(hat: HatDef, owned: HatId[], maxLevel: number): boolean {
  if (hat.cost == null) return hat.unlockLevel <= maxLevel || hat.unlockLevel === 0;
  return owned.includes(hat.id);
}

type Tab = "outfits" | "sabers" | "achievements" | "stats";

export default function WardrobeScreen({
  coinBalance, equippedHat, ownedOutfits, saberLevel, musicOn,
  onEquipHat, onBuyOutfit, onBuySaber, onToggleMusic, onToggleKids, onClose,
}: {
  coinBalance: number;
  equippedHat: HatId;
  ownedOutfits: HatId[];
  saberLevel: number;
  musicOn: boolean;
  onEquipHat: (id: HatId) => void;
  onBuyOutfit: (hat: HatDef) => void;
  onBuySaber: (tier: number) => void;
  onToggleMusic: () => void;
  onToggleKids: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("outfits");
  const [syncCode, setSyncCode] = useState<string | null>(null);
  const [syncInput, setSyncInput] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");

  useEffect(() => {
    if (tab === "stats" && syncCode === null) {
      void fetchSyncCode().then((code) => setSyncCode(code ?? "—"));
    }
  }, [tab, syncCode]);

  const handleAdopt = async () => {
    const code = syncInput.trim().toUpperCase();
    if (code.length !== 6) return;
    setSyncStatus("loading");
    const result = await adoptSyncCode(code);
    setSyncStatus(result.ok ? "ok" : "err");
    if (result.ok) setSyncCode(null);
    setTimeout(() => setSyncStatus("idle"), 4000);
  };

  const overlay: React.CSSProperties = {
    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 15,
  };

  const tabBtn = (id: Tab, label: string, icon: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className="retro-btn"
      style={{
        flex: 1, padding: "8px 4px", fontSize: "0.50rem", fontFamily: retroFont,
        background: tab === id ? "rgba(0,255,204,0.10)" : "transparent",
        color: tab === id ? "#00ffcc" : "#666",
        border: `2px solid ${tab === id ? "#00ffcc" : "#222"}`,
        boxShadow: tab === id ? "0 0 10px rgba(0,255,204,0.22)" : "none",
        cursor: "pointer", letterSpacing: "0.04em", lineHeight: 1.9,
      }}
    >
      {icon} {label}
    </button>
  );

  const maxLevel = getSaveValue("maxLevel");

  return (
    <div style={{ ...overlay, background: "rgba(0,0,10,0.94)" }}>
      <div style={{
        background: "rgba(0,255,204,0.03)", border: "2px solid #00ffcc44",
        boxShadow: "0 0 30px rgba(0,255,204,0.12)", borderRadius: 3,
        padding: "22px 24px", maxWidth: 560, width: "92%", maxHeight: "85vh", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <h2 style={{
          fontSize: "0.80rem", margin: "0 0 4px 0", color: "#00ffcc", textAlign: "center",
          fontFamily: retroFont, textShadow: "0 0 12px #00ffcc", letterSpacing: "0.06em",
        }}>
          WARDROBE
        </h2>
        <div style={{ textAlign: "center", margin: "0 0 12px 0" }}>
          <span style={{
            display: "inline-block", background: "rgba(255,238,0,0.08)", border: "2px solid #ffee00",
            boxShadow: "0 0 10px rgba(255,238,0,0.25)", borderRadius: 2,
            padding: "4px 14px", fontSize: "0.68rem", fontFamily: retroFont, color: "#ffee00",
          }}>
            ★ {coinBalance}
          </span>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
          {tabBtn("outfits", "OUTFITS", "👕")}
          {tabBtn("sabers", "SABERS", "⚔️")}
          {tabBtn("achievements", "BADGES", "🏆")}
          {tabBtn("stats", "STATS", "📊")}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {tab === "outfits" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {HATS.map(hat => {
                const owned = isHatUnlocked(hat, ownedOutfits, maxLevel);
                const isCoin = hat.cost != null;
                const equipped = equippedHat === hat.id;
                const affordable = coinBalance >= (hat.cost ?? 0);
                const subtitle = isCoin
                  ? (owned ? "Owned" : `Buy: ★ ${hat.cost}`)
                  : (hat.unlockLevel === 0 ? "Always available" : `Unlock: Level ${hat.unlockLevel}`);
                return (
                  <div key={hat.id}
                    style={{
                      background: equipped ? "rgba(0,255,204,0.07)" : "rgba(255,255,255,0.02)",
                      border: `2px solid ${equipped ? "#00ffcc" : owned ? "#333" : "#222"}`,
                      boxShadow: equipped ? "0 0 10px rgba(0,255,204,0.22)" : "none",
                      borderRadius: 3, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
                      opacity: owned ? 1 : 0.55,
                    }}>
                    <span style={{ fontSize: "1.7rem" }}>{hat.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: "bold", fontSize: "0.58rem", fontFamily: retroFont, color: "#fff", lineHeight: 1.9,
                      }}>{hat.name}</div>
                      <div style={{ fontSize: "0.55rem", color: "#555", fontFamily: font }}>{subtitle}</div>
                    </div>
                    {owned ? (
                      <button onClick={() => onEquipHat(hat.id)} className="retro-btn"
                        style={{
                          padding: "4px 8px", fontSize: "0.52rem", fontFamily: retroFont,
                          background: equipped ? "rgba(0,255,204,0.18)" : "transparent",
                          color: equipped ? "#00ffcc" : "#777",
                          border: `2px solid ${equipped ? "#00ffcc" : "#444"}`,
                          boxShadow: equipped ? "0 0 8px rgba(0,255,204,0.35)" : "none",
                          cursor: "pointer", lineHeight: 2,
                        }}>
                        {equipped ? "✓ ON" : "EQUIP"}
                      </button>
                    ) : isCoin ? (
                      <button onClick={() => affordable && onBuyOutfit(hat)} className={affordable ? "retro-btn" : undefined}
                        disabled={!affordable}
                        style={{
                          padding: "4px 8px", fontSize: "0.52rem", fontFamily: retroFont,
                          background: affordable ? "rgba(255,238,0,0.12)" : "transparent",
                          color: affordable ? "#ffee00" : "#444",
                          border: `2px solid ${affordable ? "#ffee00" : "#333"}`,
                          boxShadow: affordable ? "0 0 8px rgba(255,238,0,0.25)" : "none",
                          cursor: affordable ? "pointer" : "not-allowed", lineHeight: 2,
                        }}>
                        ★ {hat.cost}
                      </button>
                    ) : (
                      <span style={{ fontSize: "0.48rem", color: "#444", fontFamily: retroFont, lineHeight: 2 }}>
                        🔒 LV{hat.unlockLevel}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "sabers" && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {SABERS.map(s => {
                const owned = isSaberOwned(s.tier);
                const equipped = isSaberEquipped(s.tier);
                const isNext = s.tier === (getNextUnlockableSaber()?.tier ?? 99);
                const affordable = coinBalance >= s.cost;
                return (
                  <div key={s.tier}
                    style={{
                      width: 96,
                      background: equipped ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.015)",
                      border: `2px solid ${equipped ? s.color : owned ? "#333" : isNext ? s.color + "88" : "#222"}`,
                      boxShadow: equipped ? `0 0 12px ${s.color}66` : "none",
                      borderRadius: 3, padding: "10px 6px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                      opacity: owned || isNext ? 1 : 0.45,
                    }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                      {/* Chrome hilt cap above the blade swatch, echoing the
                          CHROME_ACCENT hilt added to the 3D runner model. */}
                      <div style={{ width: 9, height: 6, borderRadius: 2, background: "#e6e6f0", boxShadow: "0 0 4px rgba(230,230,240,0.6)" }} />
                      <div style={{
                        width: 5, height: 38, borderRadius: 3, background: s.color,
                        boxShadow: `0 0 10px ${s.glow}, 0 0 18px ${s.glow}`,
                      }} />
                    </div>
                    <div style={{
                      fontSize: "0.44rem", fontFamily: retroFont, color: "#ccc", lineHeight: 1.8, textAlign: "center",
                    }}>{s.name.replace(" Saber", "")}</div>
                    {equipped ? (
                      <span style={{ fontSize: "0.44rem", fontFamily: retroFont, color: s.color, lineHeight: 1.8 }}>✓ ACTIVE</span>
                    ) : owned ? (
                      <button onClick={() => equipSaber(s.tier)} className="retro-btn"
                        style={{
                          padding: "3px 6px", fontSize: "0.42rem", fontFamily: retroFont,
                          background: "transparent", color: "#888", border: "2px solid #444",
                          cursor: "pointer", lineHeight: 1.8,
                        }}>
                        EQUIP
                      </button>
                    ) : isNext ? (
                      affordable ? (
                        <button onClick={() => onBuySaber(s.tier)} className="retro-btn"
                          style={{
                            padding: "3px 6px", fontSize: "0.42rem", fontFamily: retroFont,
                            background: "rgba(255,238,0,0.12)",
                            color: "#ffee00",
                            border: "2px solid #ffee00",
                            cursor: "pointer", lineHeight: 1.8,
                          }}>
                          ★ {s.cost}
                        </button>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                          <span style={{ fontSize: "0.42rem", fontFamily: retroFont, color: "#f90", lineHeight: 1.8 }}>
                            NEED {s.cost - coinBalance} ★
                          </span>
                          <span style={{ fontSize: "0.38rem", fontFamily: retroFont, color: "#555", lineHeight: 1.5 }}>
                            ~{Math.ceil((s.cost - coinBalance) / 20)} RUNS
                          </span>
                        </div>
                      )
                    ) : (
                      <span style={{ fontSize: "0.48rem", fontFamily: retroFont, color: "#444", lineHeight: 1.8 }}>🔒</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "achievements" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{
                textAlign: "center", fontSize: "0.55rem", fontFamily: retroFont,
                color: "#00ffcc", marginBottom: 4,
              }}>
                {getUnlockedCount()} / {getTotalCount()} UNLOCKED
              </div>
              {ACHIEVEMENTS.map(ach => {
                const unlocked = isAchievementUnlocked(ach.id);
                return (
                  <div key={ach.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      background: unlocked ? "rgba(0,255,204,0.05)" : "rgba(255,255,255,0.015)",
                      border: `2px solid ${unlocked ? "#00ffcc55" : "#222"}`,
                      borderRadius: 3, padding: "8px 12px",
                      opacity: unlocked ? 1 : 0.5,
                    }}>
                    <span style={{ fontSize: "1.4rem" }}>{ach.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontWeight: "bold", fontSize: "0.56rem", fontFamily: retroFont,
                        color: unlocked ? "#fff" : "#555", lineHeight: 1.9,
                      }}>
                        {ach.secret && !unlocked ? "???" : ach.name}
                      </div>
                      <div style={{ fontSize: "0.52rem", color: "#666", fontFamily: font }}>
                        {ach.secret && !unlocked ? "Hidden achievement" : ach.description}
                      </div>
                    </div>
                    <span style={{
                      fontSize: "0.70rem", color: unlocked ? "#00ffcc" : "#333",
                    }}>
                      {unlocked ? "✓" : "○"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "stats" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <StatRow label="Total Runs" value={String(getStatValue("totalRuns"))} />
              <StatRow label="Total Deaths" value={String(getStatValue("totalDeaths"))} />
              <StatRow label="Coins Collected" value={String(getStatValue("totalCoinsCollected"))} />
              <StatRow label="Obstacles Sliced" value={String(getStatValue("totalObstaclesSliced"))} />
              <StatRow label="Total Jumps" value={String(getStatValue("totalJumps"))} />
              <StatRow label="Double Jumps" value={String(getStatValue("totalDoubleJumps"))} />
              <StatRow label="Best Score" value={String(getSaveValue("bestScore"))} />
              <StatRow label="Endless High" value={String(getEndlessHighScore())} />
              <StatRow label="Endless Dist" value={`${getEndlessBestDistance()}m`} />
              <StatRow label="Max Level" value={String(getSaveValue("maxLevel"))} />
              <StatRow label="Play Time" value={`${Math.floor(getStatValue("playTimeSeconds") / 60)}m`} />
              <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center" }}>
                <button onClick={onToggleMusic} className="retro-btn"
                  style={{
                    padding: "6px 14px", fontSize: "0.52rem", fontFamily: retroFont,
                    background: musicOn ? "rgba(255,238,0,0.10)" : "transparent",
                    color: musicOn ? "#ffee00" : "#555",
                    border: `2px solid ${musicOn ? "#ffee00" : "#333"}`,
                    cursor: "pointer", lineHeight: 2,
                  }}>
                  ♪ MUSIC {musicOn ? "ON" : "OFF"}
                </button>
                <button onClick={onToggleKids} className="retro-btn"
                  style={{
                    padding: "6px 14px", fontSize: "0.52rem", fontFamily: retroFont,
                    background: "transparent", color: "#888", border: "2px solid #333",
                    cursor: "pointer", lineHeight: 2,
                  }}>
                  🧒 KIDS MODE
                </button>
              </div>

              <div style={{
                marginTop: 16, padding: "12px", background: "rgba(0,255,204,0.04)",
                border: "1px solid #00ffcc33", borderRadius: 3,
              }}>
                <div style={{ fontSize: "0.50rem", fontFamily: retroFont, color: "#00ffcc", marginBottom: 8, letterSpacing: "0.06em" }}>
                  ☁ CROSS-DEVICE SYNC
                </div>
                <div style={{ fontSize: "0.46rem", fontFamily: font, color: "#666", marginBottom: 8 }}>
                  Share your sync code to link web and mobile progress.
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: "0.46rem", fontFamily: font, color: "#888" }}>Your code:</span>
                  <span style={{
                    fontFamily: retroFont, fontSize: "0.65rem", color: "#ffd700", letterSpacing: "0.12em",
                    background: "rgba(255,215,0,0.08)", border: "1px solid #ffd70044",
                    padding: "2px 8px", borderRadius: 2,
                  }}>
                    {syncCode === null ? "..." : syncCode}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={syncInput}
                    onChange={(e) => setSyncInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                    placeholder="Enter partner code"
                    maxLength={6}
                    style={{
                      flex: 1, padding: "5px 8px", fontSize: "0.55rem", fontFamily: retroFont,
                      background: "#0a0a22", color: "#fff", border: "1px solid #333",
                      borderRadius: 2, letterSpacing: "0.08em", outline: "none",
                    }}
                  />
                  <button
                    onClick={() => { void handleAdopt(); }}
                    disabled={syncStatus === "loading" || syncInput.length !== 6}
                    className="retro-btn"
                    style={{
                      padding: "5px 10px", fontSize: "0.46rem", fontFamily: retroFont,
                      background: "transparent",
                      color: syncStatus === "ok" ? "#00ff88" : syncStatus === "err" ? "#ff4444" : "#00ffcc",
                      border: `1px solid ${syncStatus === "ok" ? "#00ff88" : syncStatus === "err" ? "#ff4444" : "#00ffcc"}`,
                      cursor: "pointer", whiteSpace: "nowrap",
                    }}>
                    {syncStatus === "loading" ? "..." : syncStatus === "ok" ? "✓ LINKED" : syncStatus === "err" ? "✗ FAIL" : "LINK"}
                  </button>
                </div>
                {syncStatus === "ok" && (
                  <div style={{ fontSize: "0.44rem", fontFamily: font, color: "#00ff88", marginTop: 6 }}>
                    Progress merged! Reopen the game to apply.
                  </div>
                )}
                {syncStatus === "err" && (
                  <div style={{ fontSize: "0.44rem", fontFamily: font, color: "#ff4444", marginTop: 6 }}>
                    Code not found. Check and try again.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Back */}
        <button onClick={onClose} className="retro-btn"
          style={{
            marginTop: 14, width: "100%", padding: "10px", fontSize: "0.62rem", fontFamily: retroFont,
            background: "transparent", color: "#444", border: "2px solid #333",
            cursor: "pointer", letterSpacing: "0.05em",
          }}>
          ← BACK
        </button>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "6px 10px", background: "rgba(255,255,255,0.02)",
      border: "1px solid #222", borderRadius: 2,
    }}>
      <span style={{ fontSize: "0.55rem", fontFamily: retroFont, color: "#777" }}>{label}</span>
      <span style={{ fontSize: "0.60rem", fontFamily: retroFont, color: "#00ffcc" }}>{value}</span>
    </div>
  );
}
