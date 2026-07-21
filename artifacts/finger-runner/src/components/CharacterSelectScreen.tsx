// ── Character select: pick which placeholder runner (Apollo / Rocco / Santi) ──
// Each character re-tints the existing 3D finger-runner body and carries its
// own signature saber blade color. The saber TIER bought in the wardrobe
// still controls blade reach/slash power — the character only sets the color.

import { CHARACTERS } from "../three/coords";

const font = "'Courier New', monospace";
const retroFont = "'Press Start 2P', monospace";

export default function CharacterSelectScreen({
  selectedId, onPick, onStart, onClose,
}: {
  selectedId: string;
  onPick: (id: string) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  const overlay: React.CSSProperties = {
    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 15,
  };

  return (
    <div style={{ ...overlay, background: "rgba(0,0,10,0.94)" }}>
      <div style={{
        background: "rgba(0,255,204,0.03)", border: "2px solid #00ffcc44",
        boxShadow: "0 0 30px rgba(0,255,204,0.12)", borderRadius: 3,
        padding: "22px 24px", maxWidth: 620, width: "94%", maxHeight: "88vh",
        display: "flex", flexDirection: "column",
      }}>
        <h2 style={{
          fontSize: "0.80rem", margin: "0 0 4px 0", color: "#00ffcc", textAlign: "center",
          fontFamily: retroFont, textShadow: "0 0 12px #00ffcc", letterSpacing: "0.05em", lineHeight: 1.8,
        }}>
          SELECT YOUR RUNNER
        </h2>
        <p style={{
          fontSize: "0.5rem", fontFamily: retroFont, color: "#ff88ff", textAlign: "center",
          margin: "0 0 16px 0", lineHeight: 2.2, textShadow: "0 0 8px #ff88ff",
        }}>
          EACH HERO WIELDS THEIR OWN SABER!
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, overflowY: "auto", minHeight: 0 }}>
          {CHARACTERS.map(ch => {
            const picked = selectedId === ch.id;
            return (
              <button
                key={ch.id}
                onClick={() => onPick(ch.id)}
                className="retro-btn"
                style={{
                  background: picked ? "rgba(0,255,204,0.08)" : "rgba(255,255,255,0.02)",
                  border: `2px solid ${picked ? ch.saberColor : "#333"}`,
                  boxShadow: picked ? `0 0 14px ${ch.saberGlow}88` : "none",
                  borderRadius: 4, padding: "14px 8px", cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                }}>
                {/* Character portrait */}
                <div style={{ position: "relative", width: 90, height: 90 }}>
                  <span style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: "2.6rem",
                  }}>{ch.emoji}</span>
                  <img
                    src={`${import.meta.env.BASE_URL}chars/${ch.id}.png`}
                    alt={ch.name}
                    style={{ width: 90, height: 90, objectFit: "contain", position: "relative", zIndex: 1 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                {/* Saber glow bar */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <div style={{ width: 8, height: 5, borderRadius: 2, background: "#e6e6f0", boxShadow: "0 0 4px rgba(230,230,240,0.6)" }} />
                  <div style={{
                    width: 5, height: 28, borderRadius: 3, background: ch.saberColor,
                    boxShadow: `0 0 10px ${ch.saberGlow}, 0 0 18px ${ch.saberGlow}`,
                  }} />
                </div>
                <div style={{ fontSize: "0.62rem", fontFamily: retroFont, color: "#fff", lineHeight: 1.8 }}>{ch.name}</div>
                <div style={{ fontSize: "0.46rem", fontFamily: font, color: "#888" }}>{ch.ageLabel}</div>
                <div style={{
                  fontSize: "0.5rem", fontFamily: font, fontStyle: "italic",
                  color: ch.saberColor, textAlign: "center", lineHeight: 1.5,
                  minHeight: 24, textShadow: `0 0 6px ${ch.saberGlow}66`,
                }}>
                  "{ch.tagline}"
                </div>
                <div style={{
                  background: "rgba(255,255,255,0.04)", border: `1px solid ${ch.saberColor}55`,
                  borderRadius: 3, padding: "4px 6px", width: "100%", boxSizing: "border-box",
                }}>
                  <div style={{ fontSize: "0.42rem", fontFamily: retroFont, color: ch.saberColor, lineHeight: 1.8, letterSpacing: "0.03em" }}>
                    ★ {ch.traitName}
                  </div>
                  <div style={{ fontSize: "0.42rem", fontFamily: font, color: "#999", lineHeight: 1.5, marginTop: 2 }}>
                    {ch.traitDesc}
                  </div>
                </div>
                <span style={{
                  fontSize: "0.44rem", fontFamily: retroFont, lineHeight: 1.8,
                  color: picked ? ch.saberColor : "#555",
                }}>
                  {picked ? "✓ SELECTED" : "SELECT"}
                </span>
              </button>
            );
          })}
        </div>

        <button onClick={onStart} className="retro-btn retro-btn-chrome"
          style={{
            marginTop: 18, width: "100%", padding: "12px", fontSize: "0.72rem", fontFamily: retroFont,
            background: "transparent", color: "#ff4444", border: "3px solid #ff4444",
            boxShadow: "0 0 14px #ff4444, inset 0 0 14px rgba(255,68,68,0.08)",
            cursor: "pointer", letterSpacing: "0.05em", lineHeight: 1.8,
          }}>
          ▶ START GAME
        </button>
        <button onClick={onClose} className="retro-btn"
          style={{
            marginTop: 10, width: "100%", padding: "9px", fontSize: "0.6rem", fontFamily: retroFont,
            background: "transparent", color: "#444", border: "2px solid #333",
            cursor: "pointer", letterSpacing: "0.05em",
          }}>
          ← BACK
        </button>
      </div>
    </div>
  );
}
