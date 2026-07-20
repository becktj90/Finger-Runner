// ── Tabbed wardrobe: garage (vehicles), sabers, achievements, stats ──────────

import { useState, useEffect } from "react";
import {
  isSaberEquipped, isSaberOwned,
  getNextUnlockableSaber, SABER_CATALOG,
  ACHIEVEMENTS, isAchievementUnlocked, getUnlockedCount, getTotalCount,
  getStatValue, getSaveValue, getEndlessHighScore, getEndlessBestDistance,
  fetchSyncCode, adoptSyncCode,
} from "../game";
import { VEHICLES, isVehicleUnlocked, type VehicleDef, type VehicleId } from "../game/vehicleCatalog";

// Single source of truth for saber stats — same catalog the game sim reads.
const SABERS = SABER_CATALOG;

const font = "'Courier New', monospace";
const retroFont = "'Press Start 2P', monospace";

type Tab = "garage" | "sabers" | "achievements" | "stats";

// Paint-shop swatches for the ride. "" = auto (matches your character).
const PAINT_COLORS: { c: string; name: string }[] = [
  { c: "", name: "AUTO" },
  { c: "#e23b3b", name: "CHERRY" },
  { c: "#ff7f2a", name: "TANGERINE" },
  { c: "#ffd23c", name: "BANANA" },
  { c: "#39c26d", name: "SLIME" },
  { c: "#33bfd6", name: "SEAFOAM" },
  { c: "#3f74e8", name: "BLUEBERRY" },
  { c: "#8a52e0", name: "GRAPE" },
  { c: "#ff6ad5", name: "BUBBLEGUM" },
  { c: "#f0ede2", name: "CREAM" },
  { c: "#23262e", name: "MIDNIGHT" },
];

export default function WardrobeScreen({
  coinBalance, equippedVehicle, ownedVehicles, maxLevel, saberLevel, musicOn, vehicleColor,
  onEquipVehicle, onBuyVehicle, onBuySaber, onEquipSaber, onToggleMusic, onToggleKids, onSetVehicleColor, onClose,
}: {
  coinBalance: number;
  equippedVehicle: VehicleId;
  ownedVehicles: string[];
  maxLevel: number;
  saberLevel: number;
  musicOn: boolean;
  vehicleColor: string;
  onSetVehicleColor: (c: string) => void;
  onEquipVehicle: (id: VehicleId) => void;
  onBuyVehicle: (v: VehicleDef) => void;
  onBuySaber: (tier: number) => void;
  onEquipSaber: (tier: number) => void;
  onToggleMusic: () => void;
  onToggleKids: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("garage");
  const [syncCode, setSyncCode] = useState<string | null>(null);
  const [syncInput, setSyncInput] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  void saberLevel;

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
          GARAGE
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
          {tabBtn("garage", "RIDES", "🛵")}
          {tabBtn("sabers", "SABERS", "⚔️")}
          {tabBtn("achievements", "BADGES", "🏆")}
          {tabBtn("stats", "STATS", "📊")}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {tab === "garage" && (
            <>
            {/* ── Paint shop — recolor your ride ── */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: "0.52rem", fontFamily: retroFont, color: "#ff88ff", textShadow: "0 0 8px #ff88ff", lineHeight: 2.2 }}>
                🎨 PAINT SHOP
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {PAINT_COLORS.map((p) => {
                  const active = vehicleColor === p.c;
                  return (
                    <button key={p.name} onClick={() => onSetVehicleColor(p.c)} className="retro-btn"
                      aria-label={`Paint: ${p.name}`} title={p.name}
                      style={{
                        width: 34, height: 34, borderRadius: 6, cursor: "pointer", padding: 0,
                        background: p.c === "" ? "linear-gradient(135deg,#e23b3b,#3f74e8,#39c26d)" : p.c,
                        border: `3px solid ${active ? "#00ffcc" : "#333"}`,
                        boxShadow: active ? "0 0 10px rgba(0,255,204,0.6)" : "none",
                        fontSize: "0.4rem", fontFamily: retroFont,
                        color: p.c === "" ? "#fff" : "transparent",
                      }}>
                      {p.c === "" ? "A" : "."}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: "0.5rem", color: "#666", fontFamily: font, marginTop: 3 }}>
                {vehicleColor === "" ? "Auto: paint matches your character" : `Painted: ${PAINT_COLORS.find(p => p.c === vehicleColor)?.name ?? vehicleColor}`}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {VEHICLES.map(v => {
                const owned = isVehicleUnlocked(v, ownedVehicles, maxLevel);
                const isCoin = v.cost != null;
                const equipped = equippedVehicle === v.id;
                const affordable = coinBalance >= (v.cost ?? 0);
                const subtitle = isCoin
                  ? (owned ? v.blurb : `Buy: ★ ${v.cost}`)
                  : (v.unlockLevel === 0 ? v.blurb : owned ? v.blurb : `Unlock: Level ${v.unlockLevel}`);
                return (
                  <div key={v.id}
                    style={{
                      background: equipped ? "rgba(0,255,204,0.07)" : "rgba(255,255,255,0.02)",
                      border: `2px solid ${equipped ? "#00ffcc" : owned ? "#333" : "#222"}`,
                      boxShadow: equipped ? "0 0 10px rgba(0,255,204,0.22)" : "none",
                      borderRadius: 3, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
                      opacity: owned ? 1 : 0.55,
                    }}>
                    <span style={{ fontSize: "1.7rem" }}>{v.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: "bold", fontSize: "0.58rem", fontFamily: retroFont, color: "#fff", lineHeight: 1.9,
                      }}>{v.name}</div>
                      <div style={{ fontSize: "0.55rem", color: "#555", fontFamily: font }}>{subtitle}</div>
                    </div>
                    {owned ? (
                      <button onClick={() => onEquipVehicle(v.id)} className="retro-btn"
                        style={{
                          padding: "4px 8px", fontSize: "0.52rem", fontFamily: retroFont,
                          background: equipped ? "rgba(0,255,204,0.18)" : "transparent",
                          color: equipped ? "#00ffcc" : "#777",
                          border: `2px solid ${equipped ? "#00ffcc" : "#444"}`,
                          boxShadow: equipped ? "0 0 8px rgba(0,255,204,0.35)" : "none",
                          cursor: "pointer", lineHeight: 2,
                        }}>
                        {equipped ? "✓ ON" : "RIDE"}
                      </button>
                    ) : isCoin ? (
                      <button onClick={() => affordable && onBuyVehicle(v)} className={affordable ? "retro-btn" : undefined}
                        disabled={!affordable}
                        style={{
                          padding: "4px 8px", fontSize: "0.52rem", fontFamily: retroFont,
                          background: affordable ? "rgba(255,238,0,0.12)" : "transparent",
                          color: affordable ? "#ffee00" : "#444",
                          border: `2px solid ${affordable ? "#ffee00" : "#333"}`,
                          boxShadow: affordable ? "0 0 8px rgba(255,238,0,0.25)" : "none",
                          cursor: affordable ? "pointer" : "not-allowed", lineHeight: 2,
                        }}>
                        ★ {v.cost}
                      </button>
                    ) : (
                      <span style={{ fontSize: "0.48rem", color: "#444", fontFamily: retroFont, lineHeight: 2 }}>
                        🔒 LV{v.unlockLevel}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            </>
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
                      <button onClick={() => onEquipSaber(s.tier)} className="retro-btn"
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
