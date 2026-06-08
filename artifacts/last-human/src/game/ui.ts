import { FACTION_LIST, LORE } from "./constants";
import type { GameEvent, SaveData } from "./types";

export interface StationUpgradeView {
  id: string;
  name: string;
  desc: string;
  level: number;
  max: number;
  cost: number;
  affordable: boolean;
}

export interface StationView {
  factionName: string;
  factionColor: string;
  goal: string;
  desc: string;
  rep: number;
  salvage: number;
  upgrades: StationUpgradeView[];
}

export interface GameOverView {
  score: number;
  best: number;
  newHigh: boolean;
  sector: number;
  faction: string;
  factionColor: string;
  headline: string;
  headlines: string[];
}

export interface UIHandlers {
  onStart: (endless: boolean) => void;
  onResume: () => void;
  onChoice: (index: number) => void;
  onBuy: (id: string) => void;
  onLaunch: () => void;
  onRestart: () => void;
  onToggleMute: () => void;
  onShowCodex: () => void;
  onShowScores: () => void;
  onCloseCodex: () => void;
  onBoost: (held: boolean) => void;
}

function el(tag: string, cls?: string, html?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class UI {
  root: HTMLElement;
  overlay: HTMLElement;
  h: UIHandlers;
  private muteBtn: HTMLButtonElement | null = null;

  private boostBtn: HTMLButtonElement | null = null;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.h = handlers;
    this.overlay = el("div", "lh-overlay");
    this.overlay.style.display = "none";
    root.appendChild(this.overlay);
    this.buildBoostButton();
  }

  private buildBoostButton() {
    const isTouch =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches ||
        "ontouchstart" in window);
    if (!isTouch) return;
    const b = el("button", "lh-boost-btn", "BOOST") as HTMLButtonElement;
    b.style.display = "none";
    const down = (e: Event) => {
      e.preventDefault();
      this.h.onBoost(true);
      b.classList.add("active");
    };
    const up = (e: Event) => {
      e.preventDefault();
      this.h.onBoost(false);
      b.classList.remove("active");
    };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("pointerleave", up);
    this.boostBtn = b;
    this.root.appendChild(b);
  }

  showBoostButton(visible: boolean) {
    if (this.boostBtn) this.boostBtn.style.display = visible ? "flex" : "none";
  }

  destroy() {
    this.overlay.remove();
    if (this.boostBtn) {
      this.boostBtn.remove();
      this.boostBtn = null;
    }
  }

  hideOverlay() {
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
  }

  private show(content: HTMLElement, center = true) {
    this.overlay.innerHTML = "";
    this.overlay.style.display = "flex";
    this.overlay.classList.toggle("lh-overlay--center", center);
    this.overlay.appendChild(content);
  }

  setMuteLabel(muted: boolean) {
    if (this.muteBtn)
      this.muteBtn.textContent = muted ? "♪ Sound: Off" : "♪ Sound: On";
  }

  showMainMenu(save: SaveData, muted: boolean) {
    const wrap = el("div", "lh-menu");
    wrap.appendChild(el("div", "lh-title", "LAST&nbsp;HUMAN"));
    wrap.appendChild(
      el(
        "div",
        "lh-subtitle",
        "You are the last biological human in a galaxy of machines.<br/>Nobody wants to kill you. Everybody wants to <em>own</em> you.",
      ),
    );

    const stats = el(
      "div",
      "lh-stats",
      `High Score <b>${save.highScore}</b> &nbsp;·&nbsp; Deepest Sector <b>${save.bestSector}</b> &nbsp;·&nbsp; Codex <b>${save.lore.length}/${LORE.length}</b>`,
    );
    wrap.appendChild(stats);

    if (save.run) {
      const resumeRow = el("div", "lh-btnrow");
      const resume = el(
        "button",
        "lh-btn lh-btn--primary",
        `⏵ Resume Run · Sector ${save.run.sectorIndex}`,
      ) as HTMLButtonElement;
      resume.onclick = () => this.h.onResume();
      resumeRow.appendChild(resume);
      wrap.appendChild(resumeRow);
    }

    const btns = el("div", "lh-btnrow");
    const start = el(
      "button",
      save.run ? "lh-btn" : "lh-btn lh-btn--primary",
      "▶ New Run",
    ) as HTMLButtonElement;
    start.onclick = () => this.h.onStart(false);
    const endless = el("button", "lh-btn", "∞ Endless") as HTMLButtonElement;
    endless.onclick = () => this.h.onStart(true);
    btns.appendChild(start);
    btns.appendChild(endless);
    wrap.appendChild(btns);

    const btns2 = el("div", "lh-btnrow");
    const scores = el(
      "button",
      "lh-btn lh-btn--ghost",
      "🏆 Scores",
    ) as HTMLButtonElement;
    scores.onclick = () => this.h.onShowScores();
    const codex = el("button", "lh-btn lh-btn--ghost", "📖 Codex") as HTMLButtonElement;
    codex.onclick = () => this.h.onShowCodex();
    const mute = el(
      "button",
      "lh-btn lh-btn--ghost",
      muted ? "♪ Sound: Off" : "♪ Sound: On",
    ) as HTMLButtonElement;
    this.muteBtn = mute;
    mute.onclick = () => this.h.onToggleMute();
    btns2.appendChild(scores);
    btns2.appendChild(codex);
    btns2.appendChild(mute);
    wrap.appendChild(btns2);

    const help = el(
      "div",
      "lh-help",
      "Move: <b>WASD / Arrows</b> or <b>drag</b> &nbsp;·&nbsp; Boost: <b>Space</b> / hold &nbsp;·&nbsp; Collect ◆ salvage, dodge capture, reach the jump gate.",
    );
    wrap.appendChild(help);

    // faction legend
    const legend = el("div", "lh-legend");
    for (const f of FACTION_LIST) {
      const item = el("div", "lh-legend-item");
      const dot = el("span", "lh-dot");
      dot.style.background = f.color;
      dot.style.boxShadow = `0 0 8px ${f.color}`;
      item.appendChild(dot);
      item.appendChild(el("span", "", `<b>${f.short}</b> — ${f.goal}`));
      legend.appendChild(item);
    }
    wrap.appendChild(legend);

    this.show(wrap);
  }

  showCodex(save: SaveData) {
    const wrap = el("div", "lh-panel");
    wrap.appendChild(el("div", "lh-panel-title", "CODEX"));
    wrap.appendChild(
      el(
        "div",
        "lh-panel-sub",
        `${save.lore.length} of ${LORE.length} fragments recovered. Lore unlocks from ruins and anomalies.`,
      ),
    );
    const list = el("div", "lh-codex-list");
    for (const l of LORE) {
      const got = save.lore.includes(l.id);
      const item = el("div", got ? "lh-codex got" : "lh-codex locked");
      item.appendChild(el("div", "lh-codex-h", got ? l.title : "??? — Locked"));
      item.appendChild(
        el(
          "div",
          "lh-codex-b",
          got ? l.text : "Recover this fragment during a run to reveal it.",
        ),
      );
      list.appendChild(item);
    }
    wrap.appendChild(list);
    const back = el("button", "lh-btn lh-btn--primary", "← Back") as HTMLButtonElement;
    back.onclick = () => this.h.onCloseCodex();
    wrap.appendChild(back);
    this.show(wrap);
  }

  showScores(save: SaveData) {
    const wrap = el("div", "lh-panel");
    wrap.appendChild(el("div", "lh-panel-title", "HIGH SCORES"));
    wrap.appendChild(
      el(
        "div",
        "lh-panel-sub",
        `Top ${save.scores.length || 0} captures. Best <b>${save.highScore}</b> · Deepest Sector <b>${save.bestSector}</b>.`,
      ),
    );
    const list = el("div", "lh-codex-list");
    if (!save.scores.length) {
      list.appendChild(
        el(
          "div",
          "lh-codex locked",
          "<div class='lh-codex-b'>No runs recorded yet. Survive, get captured, and your score lands here.</div>",
        ),
      );
    } else {
      const fmt = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, "0")}`;
      };
      save.scores.forEach((sc, i) => {
        const d = new Date(sc.date);
        const date = `${d.getFullYear()}-${(d.getMonth() + 1)
          .toString()
          .padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
        const row = el("div", "lh-score-row");
        row.appendChild(el("span", "lh-score-rank", `#${i + 1}`));
        row.appendChild(el("span", "lh-score-val", `${sc.score}`));
        row.appendChild(
          el(
            "span",
            "lh-score-meta",
            `Sector ${sc.sector} · ${fmt(sc.duration)} · ${
              sc.endless ? "∞ Endless" : "Story"
            }`,
          ),
        );
        row.appendChild(
          el("span", "lh-score-sub", `${sc.faction} · ${date}`),
        );
        list.appendChild(row);
      });
    }
    wrap.appendChild(list);
    const back = el("button", "lh-btn lh-btn--primary", "← Back") as HTMLButtonElement;
    back.onclick = () => this.h.onCloseCodex();
    wrap.appendChild(back);
    this.show(wrap);
  }

  showEvent(ev: GameEvent) {
    const wrap = el("div", "lh-card");
    wrap.appendChild(el("div", "lh-card-tag", "ANOMALY"));
    wrap.appendChild(el("div", "lh-card-title", ev.title));
    wrap.appendChild(el("div", "lh-card-body", ev.body));
    const choices = el("div", "lh-choices");
    ev.choices.forEach((c, i) => {
      const b = el("button", "lh-choice") as HTMLButtonElement;
      b.innerHTML = `<span>${c.text}</span>`;
      b.onclick = () => this.h.onChoice(i);
      choices.appendChild(b);
    });
    wrap.appendChild(choices);
    this.show(wrap);
  }

  flashOutcome(text: string) {
    const f = el("div", "lh-flash", text);
    this.root.appendChild(f);
    requestAnimationFrame(() => f.classList.add("show"));
    setTimeout(() => {
      f.classList.remove("show");
      setTimeout(() => f.remove(), 500);
    }, 2600);
  }

  showStation(view: StationView) {
    const wrap = el("div", "lh-card lh-station");
    const tag = el("div", "lh-card-tag", "STATION");
    tag.style.color = view.factionColor;
    wrap.appendChild(tag);
    const title = el("div", "lh-card-title", view.factionName);
    title.style.color = view.factionColor;
    wrap.appendChild(title);
    wrap.appendChild(el("div", "lh-card-body", view.desc));
    wrap.appendChild(
      el(
        "div",
        "lh-station-meta",
        `Goal: <i>${view.goal}</i> &nbsp;·&nbsp; Standing: <b>${view.rep > 0 ? "+" : ""}${view.rep}</b> &nbsp;·&nbsp; ◆ <b>${view.salvage}</b>`,
      ),
    );

    const grid = el("div", "lh-upgrades");
    for (const u of view.upgrades) {
      const card = el("div", "lh-upg");
      const head = el("div", "lh-upg-head");
      head.appendChild(el("span", "lh-upg-name", u.name));
      head.appendChild(
        el("span", "lh-upg-lvl", `Lv ${u.level}/${u.max}`),
      );
      card.appendChild(head);
      card.appendChild(el("div", "lh-upg-desc", u.desc));
      const b = el("button", "lh-buy") as HTMLButtonElement;
      if (u.level >= u.max) {
        b.textContent = "MAXED";
        b.disabled = true;
      } else {
        b.textContent = `Buy · ◆ ${u.cost}`;
        b.disabled = !u.affordable;
        b.onclick = () => this.h.onBuy(u.id);
      }
      card.appendChild(b);
      grid.appendChild(card);
    }
    wrap.appendChild(grid);

    const launch = el("button", "lh-btn lh-btn--primary", "▶ Launch") as HTMLButtonElement;
    launch.onclick = () => this.h.onLaunch();
    wrap.appendChild(launch);
    this.show(wrap);
  }

  showGameOver(v: GameOverView) {
    const wrap = el("div", "lh-card lh-gameover");
    const tag = el("div", "lh-card-tag", "CAPTURED");
    tag.style.color = v.factionColor;
    wrap.appendChild(tag);
    const title = el("div", "lh-card-title", "You have been claimed.");
    wrap.appendChild(title);
    const who = el("div", "lh-go-faction", v.faction);
    who.style.color = v.factionColor;
    wrap.appendChild(who);
    wrap.appendChild(el("div", "lh-card-body", v.headline));

    wrap.appendChild(
      el(
        "div",
        "lh-go-score",
        `Score <b>${v.score}</b>${v.newHigh ? ' <span class="lh-new">NEW BEST!</span>' : ` · Best ${v.best}`} &nbsp;·&nbsp; Sector ${v.sector}`,
      ),
    );

    if (v.headlines.length) {
      const log = el("div", "lh-go-log");
      log.appendChild(el("div", "lh-go-log-h", "How the galaxy remembers you:"));
      for (const h of v.headlines) log.appendChild(el("div", "lh-go-log-line", "› " + h));
      wrap.appendChild(log);
    }

    const row = el("div", "lh-btnrow");
    const again = el("button", "lh-btn lh-btn--primary", "↻ Run Again") as HTMLButtonElement;
    again.onclick = () => this.h.onStart(v.score >= 0 ? false : false);
    const menu = el("button", "lh-btn", "Main Menu") as HTMLButtonElement;
    menu.onclick = () => this.h.onRestart();
    row.appendChild(again);
    row.appendChild(menu);
    wrap.appendChild(row);
    this.show(wrap);
  }
}
