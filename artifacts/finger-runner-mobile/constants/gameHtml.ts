// Self-contained vanilla-JS port of the Finger Runner web game (artifacts/finger-runner/src/Game.tsx).
// Rendered inside a react-native-webview. Persistence is bridged to AsyncStorage via postMessage:
//   - reads are seeded from window.__INIT_STORAGE__ (injected before content loads)
//   - writes post { type:'persist', key, value } to the React Native host
// NOTE: intentionally contains NO backticks or ${} so it nests safely in the TS template literal below.

import { THREE_MIN_JS_SOURCE } from "./threeMinJs";
import {
  FINGER_CENTER_X, DEPTH_SCALE, HEIGHT_SCALE, LANE_X, LANE_OFFSET,
  ROAD_SURFACE_OFFSET, FINGER_TIP_OFFSET,
  SLIDE_FRAMES, SLIDE_DUCK, BARRIER_GAP,
  POOL_OBSTACLES, POOL_PARTICLES, POOL_PUDDLES, POOL_COINS, POOL_POWERUPS,
  THEME_COLORS, OBSTACLE_COLORS, OBSTACLE_KIND, HAT_COLORS,
  CHROME_ACCENT, OBSTACLE_GLOW, OBSTACLE_METAL,
  BLOOM_CONFIG, BLOOM_LAYER, POWERUP_COLORS,
  CHARACTERS, DEFAULT_CHARACTER, BOOST_FRAMES, BOOST_MULT, BOOST_COOLDOWN, BOOST_GAS_COLORS,
} from "@workspace/finger-runner-3d-shared";

// These constants are serialized (via JSON.stringify) straight into the
// generated WebView document below, so the mobile 3D layer always uses the
// exact same coordinate mapping / palettes / obstacle & hat colors as the
// web React Three Fiber layer (artifacts/finger-runner/src/three/{coords.ts,
// Scene3D.tsx}) — no hand-copied duplicate values to drift out of sync.
// See @workspace/finger-runner-3d-shared for the shared source of truth.
const SHARED_3D = {
  FCX: FINGER_CENTER_X, DEPTH_SCALE, HEIGHT_SCALE, LANE_X, LANE_OFFSET,
  ROAD_SURFACE_OFFSET, FINGER_TIP_OFFSET,
  SLIDE_FRAMES, SLIDE_DUCK, BARRIER_GAP,
  N_OBSTACLES: POOL_OBSTACLES, N_PARTICLES: POOL_PARTICLES, N_PUDDLES: POOL_PUDDLES,
  N_COINS: POOL_COINS, N_POWERUPS: POOL_POWERUPS,
  THEME_COLORS, OBSTACLE_COLORS, OBSTACLE_KIND, HAT_COLORS,
  CHROME_ACCENT, OBSTACLE_GLOW, OBSTACLE_METAL,
  BLOOM_CONFIG, BLOOM_LAYER, POWERUP_COLORS,
  CHARACTERS, DEFAULT_CHARACTER, BOOST_FRAMES, BOOST_MULT, BOOST_COOLDOWN, BOOST_GAS_COLORS,
};

export const STORAGE_KEYS = {
  best: "fingerRunnerBest",
  maxLevel: "fingerRunnerMaxLevel",
  hat: "fingerRunnerHat",
  coins: "fingerRunnerCoins",
  saberOwned: "fingerRunnerSaberOwned",
  saber: "fingerRunnerSaber",
  character: "fingerRunnerCharacter",
} as const;

export const GAME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; }
  html, body { width:100%; height:100%; overflow:hidden; background:#000008; touch-action:none; overscroll-behavior:none; position:fixed; font-family:Arial, sans-serif; }
  #game { position:relative; width:100vw; height:100vh; overflow:hidden; touch-action:none; background:#000008; }
  canvas { display:block; touch-action:none; position:absolute; inset:0; }
  #c3d { z-index:1; pointer-events:none; }
  #c { z-index:2; background:transparent; }
  #dialogBubble { position:absolute; top:18%; left:50%; transform:translateX(-50%); z-index:6; font-family:Arial, sans-serif; font-size:1rem; font-weight:bold; color:#222; background:#fff; border-radius:12px; padding:8px 16px; max-width:70vw; text-align:center; opacity:0; transition:opacity 0.15s; pointer-events:none; box-shadow:0 4px 10px rgba(0,0,0,0.3); }
  #overlays { position:absolute; inset:0; z-index:10; pointer-events:none; }
  .overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; pointer-events:auto; font-family:Arial, sans-serif; padding:16px; }
  .overlay.scroll { justify-content:flex-start; overflow-y:auto; padding-top:24px; padding-bottom:24px; -webkit-overflow-scrolling:touch; }
  button { font-family:Arial, sans-serif; -webkit-appearance:none; appearance:none; }
  .pressable:active { transform:translateY(3px); filter:brightness(0.9); }
  #musicBtn { position:absolute; top:20px; right:20px; z-index:20; padding:10px 18px; font-size:1.05rem; background:rgba(0,0,0,0.6); color:#fff; border:2px solid #ffd700; border-radius:30px; cursor:pointer; pointer-events:auto; }
  #fartBtn { position:absolute; bottom:24px; left:24px; z-index:20; width:92px; height:92px; border-radius:50%; font-size:0.85rem; font-weight:bold; letter-spacing:0.02em; background:rgba(61,255,94,0.16); color:#fff; border:3px solid #3dff5e; box-shadow:0 0 16px #3dff5e; cursor:pointer; pointer-events:auto; display:none; flex-direction:column; align-items:center; justify-content:center; gap:2px; }
</style>
</head>
<body>
<div id="game">
  <canvas id="c3d"></canvas>
  <canvas id="c"></canvas>
  <div id="dialogBubble"></div>
  <div id="overlays"></div>
  <button id="musicBtn" class="pressable">&#127925; ON</button>
  <button id="fartBtn" class="pressable"><span style="font-size:1.6rem;line-height:1;">&#128168;</span>FART</button>
</div>
<script>${THREE_MIN_JS_SOURCE}</script>
<script>
(function () {
  "use strict";

  // ---- Persistence bridge ---------------------------------------------------
  // Native (react-native-webview): seeded from window.__INIT_STORAGE__ and writes
  // are posted to the RN host (AsyncStorage). Web (iframe fallback): uses localStorage.
  var INIT = window.__INIT_STORAGE__ || {};
  var hasRN = !!(window.ReactNativeWebView && window.ReactNativeWebView.postMessage);
  // Pool caps for entity arrays (must match the 3D render pool sizes used by
  // Scene3D below, and by the web build's coords.ts POOL_* constants) — see
  // pushCapped() further down for why this matters.
  var N_OBSTACLES_CAP = ${SHARED_3D.N_OBSTACLES};
  var N_PARTICLES_CAP = ${SHARED_3D.N_PARTICLES};
  var N_PUDDLES_CAP = ${SHARED_3D.N_PUDDLES};
  var N_COINS_CAP = ${SHARED_3D.N_COINS};
  var N_POWERUPS_CAP = ${SHARED_3D.N_POWERUPS};
  var COIN_R = 22; // pixel-space coin collision radius, matches web COIN_R
  function lsGet(k) { try { return window.localStorage ? window.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (window.localStorage) window.localStorage.setItem(k, v); } catch (e) {} }
  var Store = {
    data: {},
    get: function (k) {
      if (k in this.data) return this.data[k];
      if (!hasRN) { var lv = lsGet(k); if (lv !== null) { this.data[k] = lv; return lv; } }
      return null;
    },
    set: function (k, v) {
      this.data[k] = String(v);
      if (hasRN) {
        try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: "persist", key: k, value: String(v) })); } catch (e) {}
      } else {
        lsSet(k, String(v));
      }
    }
  };
  for (var ik in INIT) { if (Object.prototype.hasOwnProperty.call(INIT, ik)) Store.data[ik] = String(INIT[ik]); }

  // ---- Constants ------------------------------------------------------------
  var GRAVITY = 0.72;
  var JUMP_FORCE = -18.5;
  var LOW_JUMP_GRAVITY_MULT = 2.6;
  var FALL_GRAVITY_MULT = 1.3;
  var MAX_FALL = 24;
  var COYOTE_FRAMES = 7;
  var JUMP_BUFFER_FRAMES = 8;
  var BASE_SPEED = 2.0;
  var FINGER_TIP_OFFSET = ${SHARED_3D.FINGER_TIP_OFFSET};
  var ROAD_SURFACE_OFFSET = ${SHARED_3D.ROAD_SURFACE_OFFSET};
  var SLIDE_FRAMES = ${SHARED_3D.SLIDE_FRAMES};
  var SLIDE_DUCK = ${SHARED_3D.SLIDE_DUCK};
  var BARRIER_GAP = ${SHARED_3D.BARRIER_GAP};
  var SWIPE_THRESHOLD = 28;

  function getGroundY(h) { return h - ROAD_SURFACE_OFFSET - FINGER_TIP_OFFSET - 8; }

  // ---- Level definitions ----------------------------------------------------
  // Per-level obstacle pools mirror web Game.tsx LEVELS.obs: repeated entries
  // bias the random pick and barriers only appear from level 2 onward.
  var LEVELS = [
    { num:1, name:"Neighborhood Cruise", target:500,  theme:"suburb",   speedMult:1.0,  minSpawn:130, obs:["cat","dog","cone","cat","dog"] },
    { num:2, name:"Shopping District",   target:600,  theme:"suburb",   speedMult:1.25, minSpawn:120, obs:["cat","dog","cone","hydrant","trashcan","cone","barrier"] },
    { num:3, name:"Downtown",            target:650,  theme:"city",     speedMult:1.5,  minSpawn:110, obs:["dog","cone","hydrant","newsbox","gnome","trashcan","barrier"] },
    { num:4, name:"City Center",         target:700,  theme:"city",     speedMult:1.8,  minSpawn:100, obs:["cone","hydrant","newsbox","gnome","trashcan","mailbox","barrier"] },
    { num:5, name:"Highway On-Ramp",     target:750,  theme:"highway",  speedMult:2.1,  minSpawn:90,  obs:["hydrant","newsbox","gnome","trashcan","mailbox","bicycle","barrier"] },
    { num:6, name:"Open Highway",        target:800,  theme:"highway",  speedMult:2.5,  minSpawn:80,  obs:["newsbox","gnome","trashcan","mailbox","bicycle","stopsign","barrier","barrier"] },
    { num:7, name:"Mountain Pass",       target:900,  theme:"mountain", speedMult:3.0,  minSpawn:70,  obs:["gnome","trashcan","mailbox","bicycle","stopsign","stopsign","barrier","barrier"] },
    { num:8, name:"Night Drive",         target:1000, theme:"night",    speedMult:3.6,  minSpawn:60,  obs:["trashcan","mailbox","bicycle","stopsign","bicycle","stopsign","stopsign","barrier","barrier"] }
  ];
  function getLevelDef(num) { return LEVELS[Math.min(num - 1, LEVELS.length - 1)]; }

  // ---- Synthwave music themes -------------------------------------------------
  // Mirrors artifacts/finger-runner/src/Game.tsx MUSIC_THEMES: one distinct
  // procedural theme per screen/level-theme (root note, 8-step arpeggiated
  // melody/bass/kick pattern, waveforms/filter). Tempo is derived from the
  // level's speedMult at playback time so later levels feel faster/more intense.
  var MUSIC_THEMES = {
    start: {
      root: 196,
      melody: [0, 7, 10, 7, 3, 7, 10, 12],
      bass: [0, 0, 0, 0, 5, 5, 5, 5],
      bassGate: [true, false, false, false, true, false, false, false],
      kick: [true, false, false, false, false, false, true, false],
      leadWave: "triangle", bassWave: "sine", leadFilter: 1400, baseStepMs: 300, leadGain: 0.85
    },
    suburb: {
      root: 220,
      melody: [0, 3, 7, 10, 7, 3, 0, 5],
      bass: [0, 0, 7, 7, 0, 0, 10, 10],
      bassGate: [true, false, true, false, true, false, true, false],
      kick: [true, false, true, false, true, false, true, false],
      leadWave: "sawtooth", bassWave: "sine", leadFilter: 2200, baseStepMs: 260, leadGain: 1.0
    },
    city: {
      root: 246.94,
      melody: [0, 5, 8, 12, 8, 5, 3, 0],
      bass: [0, 0, 8, 8, 5, 5, 10, 10],
      bassGate: [true, false, true, false, true, false, true, false],
      kick: [true, false, true, true, false, true, false, true],
      leadWave: "square", bassWave: "sawtooth", leadFilter: 2600, baseStepMs: 230, leadGain: 1.0
    },
    highway: {
      root: 293.66,
      melody: [0, 3, 7, 10, 14, 10, 7, 3],
      bass: [0, 0, 3, 3, 7, 7, 10, 10],
      bassGate: [true, true, true, true, true, true, true, true],
      kick: [true, false, true, false, true, false, true, false],
      leadWave: "sawtooth", bassWave: "sawtooth", leadFilter: 3000, baseStepMs: 205, leadGain: 1.05
    },
    mountain: {
      root: 261.63,
      melody: [0, 7, 12, 7, 15, 12, 7, 3],
      bass: [0, 0, 7, 7, 3, 3, 10, 10],
      bassGate: [true, false, true, false, true, false, true, false],
      kick: [true, false, true, false, true, true, false, true],
      leadWave: "sawtooth", bassWave: "triangle", leadFilter: 1900, baseStepMs: 195, leadGain: 1.1
    },
    night: {
      root: 233.08,
      melody: [0, 3, 6, 10, 6, 3, 0, -2],
      bass: [0, 0, 6, 6, 3, 3, 10, 10],
      bassGate: [true, true, true, true, true, true, true, true],
      kick: [true, false, false, true, true, false, false, true],
      leadWave: "sawtooth", bassWave: "sawtooth", leadFilter: 1500, baseStepMs: 185, leadGain: 1.1
    }
  };

  // ---- Hat catalogue --------------------------------------------------------
  var HATS = [
    { id:"none",   name:"Bare Knuckle",  emoji:"\\uD83E\\uDD1A", unlockLevel:0 },
    { id:"tophat", name:"Top Hat",       emoji:"\\uD83C\\uDFA9", unlockLevel:2 },
    { id:"cap",    name:"Baseball Cap",  emoji:"\\uD83E\\uDDE2", unlockLevel:3 },
    { id:"crown",  name:"Gold Crown",    emoji:"\\uD83D\\uDC51", unlockLevel:5 },
    { id:"cowboy", name:"Cowboy Hat",    emoji:"\\uD83E\\uDD20", unlockLevel:6 },
    { id:"viking", name:"Viking Helmet", emoji:"\\u2694\\uFE0F", unlockLevel:8 }
  ];

  // ---- Lightsaber tiers -------------------------------------------------------
  // Mirrors Game.tsx SABERS. Players unlock tiers with coins collected during
  // runs (tier 1 red is always free). The equipped tier is persisted to
  // AsyncStorage and passed to Scene3D.update so the blade color/glow/reach
  // update automatically. The blade is tagged with BLOOM_LAYER so it glows.
  var SABERS = [
    { tier:1, name:"Red Saber",    emoji:"\\uD83D\\uDD34", color:"#ff2b2b", glow:"#ff6b6b", reach:120, cost:0   },
    { tier:2, name:"Orange Saber", emoji:"\\uD83D\\uDFE0", color:"#ff9500", glow:"#ffbe5c", reach:135, cost:60  },
    { tier:3, name:"Green Saber",  emoji:"\\uD83D\\uDFE2", color:"#34ff5e", glow:"#86ff9e", reach:150, cost:130 },
    { tier:4, name:"Blue Saber",   emoji:"\\uD83D\\uDD35", color:"#36b8ff", glow:"#8fd9ff", reach:165, cost:230 },
    { tier:5, name:"Purple Saber", emoji:"\\uD83D\\uDFE3", color:"#b14bff", glow:"#d49bff", reach:185, cost:380 }
  ];
  function getSaberDef(tier) { return SABERS[Math.min(SABERS.length, Math.max(1, tier)) - 1]; }

  // ---- Characters (playable runners) + FART BOOST -----------------------------
  // Mirrors web Game.tsx / CharacterSelectScreen. Each character re-tints the
  // placeholder finger body (backHand/finger/knuckle/nail) and owns a saber
  // color/glow. FART BOOST briefly multiplies world speed and spews green gas.
  // Data comes from @workspace/finger-runner-3d-shared (JSON.stringify'd in).
  var CHARACTERS = ${JSON.stringify(SHARED_3D.CHARACTERS)};
  var DEFAULT_CHARACTER = ${JSON.stringify(SHARED_3D.DEFAULT_CHARACTER)};
  function getCharacterDef(id) {
    for (var ci = 0; ci < CHARACTERS.length; ci++) { if (CHARACTERS[ci].id === id) return CHARACTERS[ci]; }
    return CHARACTERS[0];
  }
  var BOOST_FRAMES = ${SHARED_3D.BOOST_FRAMES};
  var BOOST_MULT = ${SHARED_3D.BOOST_MULT};
  var BOOST_COOLDOWN = ${SHARED_3D.BOOST_COOLDOWN};
  var BOOST_GAS_COLORS = ${JSON.stringify(SHARED_3D.BOOST_GAS_COLORS)};

  // ---- Storyline & dialog ---------------------------------------------------
  var STORY_INTRO = "Trapped in a boring sedan on the world's longest road trip, two restless fingers \\u2014 Lefty & Middy \\u2014 spot a cracked-open window and make a break for it. Eight wild stretches of road stand between them and freedom.";
  var LEVEL_STORY = {
    1: "Day one of freedom \\u2014 the open suburb awaits!",
    2: "So many shoppers, so many feet to dodge\\u2026",
    3: "Downtown! Keep it together, knuckles.",
    4: "Rush hour. Everyone's in a hurry but us!",
    5: "Merging onto the highway \\u2014 hold onto your nails!",
    6: "Pedal to the metal\\u2026 er, finger to the asphalt!",
    7: "Mountain air! Don't look down, Middy.",
    8: "One last sprint under the stars. Almost home!"
  };
  var RUN_QUIPS = [
    "Wheee!", "Freedom tastes like asphalt!", "Can't catch us!", "Run, Middy, run!",
    "My nails look fabulous today.", "Is it leg day? It's always leg day.",
    "We were BORN to run!", "Two fingers, one dream.", "Don't look back!",
    "This is the way.", "Knuckle down!", "Living on the edge!", "So bouncy!"
  ];
  var JUMP_QUIPS = ["Hup!", "Boing!", "Up we go!", "Weeee!", "Air time!", "Springy!"];
  var CRASH_QUIPS = [
    "Should've moisturized.", "Finger down! I repeat, finger down!",
    "Well, that'll leave a callus.", "Ow. OW. OWWW.", "Tell my thumb I love it\\u2026",
    "That's gonna need a band-aid.", "I regret everything.", "Cramp! It was a cramp!"
  ];

  // ---- Helpers --------------------------------------------------------------
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function getMaxLevel() { return parseInt(Store.get("${"fingerRunnerMaxLevel"}") || "1", 10); }
  function setMaxLevel(n) { Store.set("${"fingerRunnerMaxLevel"}", String(n)); }
  function getEquippedHat() { return Store.get("${"fingerRunnerHat"}") || "none"; }
  function setEquippedHat(id) { Store.set("${"fingerRunnerHat"}", id); }
  function getTotalCoins() { return parseInt(Store.get("${"fingerRunnerCoins"}") || "0", 10); }
  function setTotalCoins(n) { Store.set("${"fingerRunnerCoins"}", String(Math.max(0, n))); }
  function getHighestOwnedSaber() { return parseInt(Store.get("${"fingerRunnerSaberOwned"}") || "1", 10); }
  function setHighestOwnedSaber(tier) { Store.set("${"fingerRunnerSaberOwned"}", String(tier)); }
  function getEquippedSaber() { return parseInt(Store.get("${"fingerRunnerSaber"}") || "1", 10); }
  function setEquippedSaber(tier) { Store.set("${"fingerRunnerSaber"}", String(tier)); }
  function getSelectedCharacter() { return Store.get("${"fingerRunnerCharacter"}") || DEFAULT_CHARACTER; }
  function setSelectedCharacter(id) { Store.set("${"fingerRunnerCharacter"}", id); }

  // ---- State ----------------------------------------------------------------
  var st = {
    gameRunning: false,
    levelComplete: false,
    currentLevel: 1,
    levelScore: 0,
    totalScore: 0,
    bestScore: parseInt(Store.get("${"fingerRunnerBest"}") || "0", 10),
    time: 0,
    velocity: 0,
    playerY: 300,
    spawnTimer: 0,
    onGround: true,
    lane: 0,
    laneVisual: 0,
    sliding: false,
    slideTimer: 0,
    slideQueued: false,
    jumpsUsed: 0,
    jumpHeld: false,
    coyoteTimer: 0,
    jumpBuffer: 0,
    landImpact: 0,
    shake: 0,
    obstacles: [],
    coins: [],
    powerUps: [],
    particles: [],
    bloodPuddles: [],
    crashFlash: 0,
    dialog: null,
    dialogCooldown: 200,
    worldScroll: 0,
    coinSpawnTimer: 0,
    powerUpSpawnTimer: 0,
    boostTimer: 0,
    boostCooldown: 0,
    coinBalance: getTotalCoins(),
    lastRunBonus: 0
  };

  var audio = { ctx:null, enabled:true, interval:null, melodyOsc:null, bassOsc:null, kickOsc:null, step:0, currentThemeId:null, transitionSeq:0 };

  // ---- Audio ----------------------------------------------------------------
  function initAudio() {
    if (!audio.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audio.ctx = new AC();
    }
    if (audio.ctx && audio.ctx.state === "suspended") { try { audio.ctx.resume(); } catch (e) {} }
  }
  function stopMusic() {
    audio.transitionSeq++;
    if (audio.interval) { clearInterval(audio.interval); audio.interval = null; }
    try { if (audio.melodyOsc) { audio.melodyOsc.stop(); audio.melodyOsc = null; } } catch (e) {}
    try { if (audio.bassOsc) { audio.bassOsc.stop(); audio.bassOsc = null; } } catch (e) {}
    try { if (audio.kickOsc) { audio.kickOsc.stop(); audio.kickOsc = null; } } catch (e) {}
  }
  // Plays the synthwave theme for themeId ("start" or a level theme id). isPlaying
  // selects louder/faster in-run intensity vs. quieter/slower menu intensity;
  // speedMult (from the level def) further ramps tempo for later, faster levels.
  function startMusic(themeId, isPlaying, speedMult) {
    if (!audio.enabled) return;
    initAudio();
    stopMusic(); // always start from a clean slate — no overlapping oscillators/intervals
    var theme = MUSIC_THEMES[themeId] || MUSIC_THEMES.start;
    audio.currentThemeId = themeId;
    audio.step = 0;
    var sm = speedMult || 1;
    var tempoScale = 1 / (0.65 + sm * 0.35);
    var stepMs = Math.max(90, theme.baseStepMs * tempoScale * (isPlaying ? 1 : 1.35));
    audio.interval = setInterval(function () {
      var ctx = audio.ctx; if (!ctx) return;
      var t = ctx.currentTime;
      var i = audio.step % theme.melody.length;
      var note = theme.root * Math.pow(2, theme.melody[i] / 12);
      try { if (audio.melodyOsc) audio.melodyOsc.stop(); } catch (e) {}
      audio.melodyOsc = ctx.createOscillator();
      var mGain = ctx.createGain(); var mFilter = ctx.createBiquadFilter();
      audio.melodyOsc.type = theme.leadWave; audio.melodyOsc.frequency.value = note;
      mFilter.type = "lowpass"; mFilter.frequency.value = theme.leadFilter;
      var vol = (isPlaying ? 0.18 : 0.09) * theme.leadGain; var envTime = isPlaying ? 0.34 : 0.5;
      mGain.gain.value = vol; mGain.gain.setValueAtTime(vol, t); mGain.gain.linearRampToValueAtTime(0.001, t + envTime);
      audio.melodyOsc.connect(mFilter); mFilter.connect(mGain); mGain.connect(ctx.destination);
      audio.melodyOsc.start(t); audio.melodyOsc.stop(t + envTime + 0.05);
      if (theme.bassGate[i]) {
        try { if (audio.bassOsc) audio.bassOsc.stop(); } catch (e) {}
        audio.bassOsc = ctx.createOscillator(); var bGain = ctx.createGain();
        var bNote = (theme.root / 2) * Math.pow(2, theme.bass[i] / 12);
        audio.bassOsc.type = theme.bassWave; audio.bassOsc.frequency.value = bNote;
        bGain.gain.value = isPlaying ? 0.5 : 0.28; bGain.gain.linearRampToValueAtTime(0.001, t + 0.6);
        audio.bassOsc.connect(bGain); bGain.connect(ctx.destination); audio.bassOsc.start(t); audio.bassOsc.stop(t + 0.65);
      }
      if (theme.kick[i]) {
        try { if (audio.kickOsc) audio.kickOsc.stop(); } catch (e) {}
        audio.kickOsc = ctx.createOscillator(); var kGain = ctx.createGain(); var kFilter = ctx.createBiquadFilter();
        audio.kickOsc.type = "sine"; audio.kickOsc.frequency.value = 95;
        kFilter.type = "lowpass"; kFilter.frequency.value = 450;
        kGain.gain.value = 1.1; kGain.gain.linearRampToValueAtTime(0.001, t + 0.4);
        audio.kickOsc.frequency.setValueAtTime(95, t); audio.kickOsc.frequency.linearRampToValueAtTime(42, t + 0.22);
        audio.kickOsc.connect(kFilter); kFilter.connect(kGain); kGain.connect(ctx.destination);
        audio.kickOsc.start(t); audio.kickOsc.stop(t + 0.45);
      }
      audio.step++;
    }, stepMs);
  }
  function playJumpSound() {
    if (!audio.enabled || !audio.ctx) return;
    var ctx = audio.ctx; var osc = ctx.createOscillator(); var gain = ctx.createGain(); var filter = ctx.createBiquadFilter();
    osc.type = "sawtooth"; osc.frequency.value = 680; filter.type = "lowpass"; filter.frequency.value = 1200;
    var t = ctx.currentTime;
    osc.frequency.setValueAtTime(680, t); osc.frequency.linearRampToValueAtTime(420, t + 0.18);
    gain.gain.setValueAtTime(0.35, t); gain.gain.linearRampToValueAtTime(0.001, t + 0.22);
    osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination); osc.start(t); osc.stop(t + 0.25);
  }
  function playCrashSound() {
    if (!audio.enabled || !audio.ctx) return;
    var ctx = audio.ctx; var t = ctx.currentTime; var i;
    var crackBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
    var crackData = crackBuf.getChannelData(0);
    for (i = 0; i < crackData.length; i++) crackData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / crackData.length, 3);
    var crack = ctx.createBufferSource(); crack.buffer = crackBuf;
    var crackFilter = ctx.createBiquadFilter(); crackFilter.type = "highpass"; crackFilter.frequency.value = 1800;
    var crackGain = ctx.createGain(); crackGain.gain.setValueAtTime(2.2, t); crackGain.gain.linearRampToValueAtTime(0, t + 0.12);
    crack.connect(crackFilter); crackFilter.connect(crackGain); crackGain.connect(ctx.destination); crack.start(t);
    var splatBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    var splatData = splatBuf.getChannelData(0);
    for (i = 0; i < splatData.length; i++) splatData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / splatData.length, 1.5);
    var splat = ctx.createBufferSource(); splat.buffer = splatBuf;
    var splatFilter = ctx.createBiquadFilter(); splatFilter.type = "lowpass"; splatFilter.frequency.value = 600;
    var splatGain = ctx.createGain(); splatGain.gain.setValueAtTime(1.6, t + 0.04); splatGain.gain.linearRampToValueAtTime(0, t + 0.55);
    splat.connect(splatFilter); splatFilter.connect(splatGain); splatGain.connect(ctx.destination); splat.start(t + 0.04);
    var boom = ctx.createOscillator(); var boomGain = ctx.createGain();
    boom.type = "sine"; boom.frequency.setValueAtTime(110, t); boom.frequency.linearRampToValueAtTime(30, t + 0.4);
    boomGain.gain.setValueAtTime(1.4, t); boomGain.gain.linearRampToValueAtTime(0, t + 0.9);
    boom.connect(boomGain); boomGain.connect(ctx.destination); boom.start(t); boom.stop(t + 0.95);
    var yelp = ctx.createOscillator(); var yelpGain = ctx.createGain(); var yelpFilter = ctx.createBiquadFilter();
    yelp.type = "sawtooth"; yelpFilter.type = "lowpass"; yelpFilter.frequency.value = 900;
    yelp.frequency.setValueAtTime(520, t + 0.06); yelp.frequency.linearRampToValueAtTime(180, t + 0.45);
    yelpGain.gain.setValueAtTime(0.5, t + 0.06); yelpGain.gain.linearRampToValueAtTime(0, t + 0.5);
    yelp.connect(yelpFilter); yelpFilter.connect(yelpGain); yelpGain.connect(ctx.destination); yelp.start(t + 0.06); yelp.stop(t + 0.55);
  }
  function playLevelUpSound() {
    if (!audio.enabled) return;
    initAudio(); var ctx = audio.ctx; if (!ctx) return;
    var t = ctx.currentTime;
    [523, 659, 784, 1047].forEach(function (freq, i) {
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = "triangle"; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.4, t + i * 0.12); g.gain.linearRampToValueAtTime(0, t + i * 0.12 + 0.25);
      osc.connect(g); g.connect(ctx.destination); osc.start(t + i * 0.12); osc.stop(t + i * 0.12 + 0.3);
    });
  }

  // ---- Funny kid SFX + per-character signature voices -----------------------
  // Wet, sputtery fart for the FART BOOST — pitch randomized each toot.
  function playFart() {
    if (!audio.enabled) return;
    initAudio(); var ctx = audio.ctx; if (!ctx) return;
    var t = ctx.currentTime;
    var base = 70 + Math.random() * 55;
    var dur = 0.42 + Math.random() * 0.28;
    var osc = ctx.createOscillator(); var g = ctx.createGain(); var f = ctx.createBiquadFilter();
    osc.type = "sawtooth"; f.type = "lowpass"; f.frequency.value = 900;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 1.7, t + dur * 0.3);
    osc.frequency.linearRampToValueAtTime(base * 0.7, t + dur);
    var lfo = ctx.createOscillator(); var lg = ctx.createGain();
    lfo.type = "square"; lfo.frequency.setValueAtTime(19, t); lfo.frequency.linearRampToValueAtTime(8, t + dur);
    lg.gain.value = base * 0.55; lfo.connect(lg); lg.connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.34, t + 0.03);
    g.gain.setValueAtTime(0.3, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(f); f.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02); lfo.start(t); lfo.stop(t + dur + 0.02);
    var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    var d = buf.getChannelData(0); var i;
    for (i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.2);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var nf = ctx.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 340; nf.Q.value = 0.8;
    var ng = ctx.createGain(); ng.gain.setValueAtTime(0.13, t); ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(nf); nf.connect(ng); ng.connect(ctx.destination); src.start(t);
    if (Math.random() < 0.5) {
      var sq = ctx.createOscillator(); var sg = ctx.createGain();
      sq.type = "sawtooth"; sq.frequency.setValueAtTime(base * 3, t + dur * 0.72);
      sq.frequency.linearRampToValueAtTime(base * 6, t + dur);
      sg.gain.setValueAtTime(0.0001, t + dur * 0.72); sg.gain.linearRampToValueAtTime(0.1, t + dur * 0.8);
      sg.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.05);
      sq.connect(sg); sg.connect(ctx.destination); sq.start(t + dur * 0.72); sq.stop(t + dur + 0.06);
    }
  }
  // Apollo -> bright, confident "yeah!"
  function playCheer() {
    if (!audio.enabled) return;
    initAudio(); var ctx = audio.ctx; if (!ctx) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator(); var g = ctx.createGain(); var f = ctx.createBiquadFilter();
    osc.type = "square"; f.type = "bandpass"; f.Q.value = 4;
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(640, t + 0.14);
    osc.frequency.linearRampToValueAtTime(520, t + 0.34);
    f.frequency.setValueAtTime(800, t); f.frequency.linearRampToValueAtTime(1750, t + 0.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.05);
    g.gain.setValueAtTime(0.2, t + 0.24); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(f); f.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.42);
  }
  // Rocco -> toddler "hee-hee-hee-hee" giggle
  function playGiggle() {
    if (!audio.enabled) return;
    initAudio(); var ctx = audio.ctx; if (!ctx) return;
    var t0 = ctx.currentTime; var i;
    for (i = 0; i < 4; i++) {
      var tt = t0 + i * 0.11;
      var osc = ctx.createOscillator(); var g = ctx.createGain(); var f = ctx.createBiquadFilter();
      osc.type = "triangle"; f.type = "bandpass"; f.frequency.value = 1600; f.Q.value = 6;
      var p = 900 + i * 70;
      osc.frequency.setValueAtTime(p, tt); osc.frequency.linearRampToValueAtTime(p * 1.3, tt + 0.05);
      osc.frequency.linearRampToValueAtTime(p * 0.9, tt + 0.09);
      g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.16, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.1);
      osc.connect(f); f.connect(g); g.connect(ctx.destination); osc.start(tt); osc.stop(tt + 0.12);
    }
  }
  // Santi -> happy two-woof bark
  function playBark() {
    if (!audio.enabled) return;
    initAudio(); var ctx = audio.ctx; if (!ctx) return;
    function woof(t) {
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1500;
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(330, t);
      osc.frequency.exponentialRampToValueAtTime(135, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.28, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(f); f.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.18);
      var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
      var d = buf.getChannelData(0); var i;
      for (i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      var src = ctx.createBufferSource(); src.buffer = buf;
      var nf = ctx.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 900; nf.Q.value = 1;
      var ng = ctx.createGain(); ng.gain.setValueAtTime(0.16, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      src.connect(nf); nf.connect(ng); ng.connect(ctx.destination); src.start(t);
    }
    var t0 = ctx.currentTime; woof(t0); woof(t0 + 0.2);
  }
  // Play a character's signature voice (used when a character is picked).
  function playCharacterVoice(id) {
    var v = getCharacterDef(id).voice;
    if (v === "giggle") { playGiggle(); return; }
    if (v === "bark") { playBark(); return; }
    playCheer();
  }

  // ---- Obstacles ------------------------------------------------------------
  var OBSTACLE_TYPES = [
    { type:"mailbox",  w:36, h:68 }, { type:"hydrant",  w:34, h:58 },
    { type:"stopsign", w:22, h:88 }, { type:"trashcan", w:36, h:66 },
    { type:"dog",      w:44, h:46 }, { type:"cat",      w:28, h:42 },
    { type:"bicycle",  w:46, h:68 }, { type:"gnome",    w:30, h:62 },
    { type:"cone",     w:32, h:56 }, { type:"newsbox",  w:36, h:60 },
    { type:"barrier",  w:44, h:170 } // overhead gantry — collision uses BARRIER_GAP, not this height
  ];
  // type -> dimensions lookup, so spawnObstacle can pull dims by the type
  // chosen from a level's obs pool (mirrors web OBSTACLE_DIMS + LEVELS.obs).
  var OBSTACLE_DIMS = {};
  for (var _oti = 0; _oti < OBSTACLE_TYPES.length; _oti++) { OBSTACLE_DIMS[OBSTACLE_TYPES[_oti].type] = OBSTACLE_TYPES[_oti]; }
  // Never push into a pooled entity array past its 3D render pool size
  // (N_OBSTACLES/N_PARTICLES/N_PUDDLES) — extra entities would still be
  // fully live for collision but never drawn, causing invisible obstacles.
  function pushCapped(arr, cap, item) {
    if (arr.length < cap) arr.push(item);
  }

  function spawnObstacle(width) {
    if (st.obstacles.length >= N_OBSTACLES_CAP) return;
    // Per-level obstacle pool (barriers only appear level 2+), mirroring web.
    var pool = getLevelDef(st.currentLevel).obs;
    var type = pool[Math.floor(Math.random() * pool.length)];
    var dim = OBSTACLE_DIMS[type] || OBSTACLE_TYPES[0];
    var lane = Math.floor(Math.random() * 3) - 1; // -1 left, 0 center, 1 right
    st.obstacles.push({ x: width + 80, obsWidth: dim.w, obsHeight: dim.h, type: type, passed: false, lane: lane });
  }

  // ---- Side-to-side lane movement --------------------------------------------
  // Mirrors the web build's lane system: lane is the committed lane used for
  // collision (-1/0/1), laneVisual eases toward it each frame purely for the
  // 3D render layer's smooth slide. Triggered by a horizontal swipe (no keyboard
  // on mobile -- see the touch handlers below).
  function moveLane(dir) {
    if (!st.gameRunning) return;
    var next = Math.max(-1, Math.min(1, st.lane + dir));
    if (next === st.lane) return;
    st.lane = next;
  }

  // ---- Game events ----------------------------------------------------------
  function createCrashExplosion(x, y, roadY) {
    var bloodColors = ["#8B0000","#CC0000","#DC143C","#B22222","#FF0000","#990000"];
    var boneColors  = ["#FFFACD","#F5F5DC","#E8E8D0","#D8D0C0"];
    var skinColors  = ["#c8946f","#d4a07a","#b8804a"];
    var i, angle, speed;
    for (i = 0; i < 55; i++) {
      angle = Math.random() * Math.PI * 2;
      speed = 1.5 + Math.random() * 8;
      pushCapped(st.particles, N_PARTICLES_CAP, {
        x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2.5 - Math.random() * 3,
        life: 55 + Math.random() * 35, size: 4 + Math.random() * 9,
        color: bloodColors[Math.floor(Math.random() * bloodColors.length)], shape: "circle"
      });
    }
    for (i = 0; i < 12; i++) {
      angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      speed = 4 + Math.random() * 7;
      pushCapped(st.particles, N_PARTICLES_CAP, {
        x: x, y: y - 10 + Math.random() * 20,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 3,
        life: 45 + Math.random() * 25, size: 5 + Math.random() * 7,
        color: boneColors[Math.floor(Math.random() * boneColors.length)],
        shape: "bone", rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.4
      });
    }
    for (i = 0; i < 10; i++) {
      angle = Math.random() * Math.PI * 2; speed = 2 + Math.random() * 5;
      pushCapped(st.particles, N_PARTICLES_CAP, { x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
        life: 35 + Math.random() * 20, size: 8 + Math.random() * 10,
        color: skinColors[Math.floor(Math.random() * 3)], shape: "rect" });
    }
    pushCapped(st.bloodPuddles, N_PUDDLES_CAP, { x: x + (Math.random() - 0.5) * 60, y: roadY - 4,
      rx: 28 + Math.random() * 28, ry: 8 + Math.random() * 8, life: 420, maxLife: 420 });
    for (var k = 0; k < 3; k++) {
      pushCapped(st.bloodPuddles, N_PUDDLES_CAP, { x: x + (Math.random() - 0.5) * 120, y: roadY - 3,
        rx: 8 + Math.random() * 14, ry: 3 + Math.random() * 5, life: 360, maxLife: 360 });
    }
  }

  function crash() {
    if (!st.gameRunning) return;
    var roadY = VH - ROAD_SURFACE_OFFSET;
    st.gameRunning = false;
    st.crashFlash = 28;
    st.shake = 18;
    st.jumpHeld = false;
    showDialog(pick(CRASH_QUIPS), 200);
    playCrashSound();
    createCrashExplosion(185, st.playerY + 30, roadY);
    if (st.totalScore > st.bestScore) {
      st.bestScore = Math.floor(st.totalScore);
      Store.set("${"fingerRunnerBest"}", String(st.bestScore));
    }
    var runBonus = Math.floor(st.levelScore / 100);
    st.lastRunBonus = runBonus;
    if (runBonus > 0) {
      st.coinBalance += runBonus;
      setTotalCoins(st.coinBalance);
    }
    stopMusic();
    var seqAtCrash = audio.transitionSeq;
    setTimeout(function () {
      if (seqAtCrash === audio.transitionSeq && !st.gameRunning && audio.enabled) {
        var lvlDef = getLevelDef(st.currentLevel);
        startMusic(lvlDef.theme, false, lvlDef.speedMult);
      }
    }, 600);
    setScreen("dead");
  }

  function levelCompleteEvent() {
    if (!st.gameRunning || st.levelComplete) return;
    st.gameRunning = false;
    st.levelComplete = true;
    var lvlCompleteBonus = Math.floor(st.levelScore / 100);
    st.lastRunBonus = lvlCompleteBonus;
    if (lvlCompleteBonus > 0) {
      st.coinBalance += lvlCompleteBonus;
      setTotalCoins(st.coinBalance);
    }
    playLevelUpSound();
    stopMusic();
    var lvl = st.currentLevel;
    var seqAtComplete = audio.transitionSeq;
    setTimeout(function () {
      if (seqAtComplete === audio.transitionSeq && !st.gameRunning && audio.enabled) {
        var lvlDef = getLevelDef(lvl);
        startMusic(lvlDef.theme, false, lvlDef.speedMult);
      }
    }, 600);
    var newMax = Math.max(getMaxLevel(), lvl + 1);
    setMaxLevel(newMax);
    var nextUnlock = null;
    for (var i = 0; i < HATS.length; i++) { if (HATS[i].unlockLevel === lvl + 1) { nextUnlock = HATS[i]; break; } }
    ui.unlockedHat = nextUnlock;
    ui.completedLevel = lvl;
    st.currentLevel = lvl;
    setTimeout(function () { setScreen("levelComplete"); }, 300);
  }

  function showDialog(text, frames) {
    if (frames === undefined) frames = 150;
    st.dialog = { text: text, life: frames, maxLife: frames };
  }

  function spawnDust(count, spread) {
    for (var i = 0; i < count; i++) {
      pushCapped(st.particles, N_PARTICLES_CAP, {
        x: 170 + Math.random() * 30, y: st.playerY + FINGER_TIP_OFFSET - 4,
        vx: (Math.random() - 0.5) * spread, vy: -1.5 - Math.random() * 2.5,
        life: 20 + Math.random() * 12, size: 4 + Math.random() * 5,
        color: "#cbb79a", shape: "circle"
      });
    }
  }

  function doJump(isDouble) {
    st.jumpsUsed += 1;
    st.velocity = isDouble ? JUMP_FORCE * 0.9 : JUMP_FORCE;
    st.onGround = false;
    st.coyoteTimer = 0;
    st.landImpact = 0;
    playJumpSound();
    spawnDust(isDouble ? 6 : 9, 6);
    if (Math.random() < 0.18) showDialog(pick(JUMP_QUIPS), 70);
  }

  function jump() {
    initAudio();
    if (!st.gameRunning) return;
    // A jump always cancels an active/queued slide (you can hop out of a duck).
    st.sliding = false; st.slideTimer = 0; st.slideQueued = false;
    st.jumpHeld = true;
    if (st.onGround || st.coyoteTimer > 0) {
      doJump(false);
    } else if (st.jumpsUsed < 2) {
      doJump(true);
    } else {
      st.jumpBuffer = JUMP_BUFFER_FRAMES;
    }
  }

  function releaseJump() { st.jumpHeld = false; }

  // ---- Slide / duck ----------------------------------------------------------
  // Swipe down (or, on web, ArrowDown/S). On the ground: duck for SLIDE_FRAMES
  // so the hurtbox head drops below an overhead barrier. In the air: dive to
  // the ground fast and auto-duck the instant we land (slideQueued). Mirrors
  // web Game.tsx slide().
  function slide() {
    initAudio();
    if (!st.gameRunning) return;
    if (st.onGround || st.coyoteTimer > 0) {
      st.sliding = true;
      st.slideTimer = SLIDE_FRAMES;
      st.slideQueued = false;
      spawnDust(6, 8);
    } else {
      st.slideQueued = true;
      st.velocity = MAX_FALL; // fast dive toward the ground
    }
  }

  function startLevel(levelNum) {
    initAudio();
    var groundY = getGroundY(VH);
    st.gameRunning = true;
    st.levelComplete = false;
    st.currentLevel = levelNum;
    st.levelScore = 0;
    st.obstacles = [];
    st.coins = [];
    st.powerUps = [];
    st.coinSpawnTimer = 0;
    st.powerUpSpawnTimer = 0;
    st.particles = [];
    st.bloodPuddles = [];
    st.crashFlash = 0;
    st.coinBalance = getTotalCoins();
    st.playerY = groundY;
    st.velocity = 0;
    st.onGround = true;
    st.jumpsUsed = 0;
    st.jumpHeld = false;
    st.coyoteTimer = 0;
    st.jumpBuffer = 0;
    st.landImpact = 0;
    st.shake = 0;
    st.spawnTimer = 0;
    st.time = 0;
    st.lane = 0;
    st.laneVisual = 0;
    st.sliding = false;
    st.slideTimer = 0;
    st.slideQueued = false;
    st.dialog = { text: LEVEL_STORY[levelNum] || pick(RUN_QUIPS), life: 200, maxLife: 200 };
    st.dialogCooldown = 320;
    st.worldScroll = 0;
    st.boostTimer = 0;
    st.boostCooldown = 0;
    setScreen("playing");
    stopMusic();
    if (audio.enabled) {
      var startedLvlDef = getLevelDef(levelNum);
      setTimeout(function () { startMusic(startedLvlDef.theme, true, startedLvlDef.speedMult); }, 80);
    }
  }

  // ---- 3D render layer (Scene3D) --------------------------------------------
  // Pure rendering: reads the existing (unmodified) physics/game state each
  // frame from st and imperatively positions Three.js objects. No gameplay
  // logic lives here -- physics, spawning, collision, scoring, and persistence
  // are handled entirely above/below exactly as before. Mirrors the web app's
  // artifacts/finger-runner/src/three/{coords.ts,Scene3D.tsx}, ported to
  // vanilla JS (Three.js loaded via CDN -- no bundler on mobile).
  var Scene3D = (function () {
    // Coordinate constants, theme/obstacle/hat palettes below are generated
    // from @workspace/finger-runner-3d-shared at build time (JSON.stringify'd
    // straight into this document) -- they are NOT hand-copied from the web
    // Scene3D.tsx, so the two 3D layers can't drift out of sync on these
    // values. See that package + coords.ts for the single source of truth.
    var HIDE_Z = -9999;
    var FCX = ${SHARED_3D.FCX}; // FINGER_CENTER_X (old screen-space x of the runner's hurtbox center)
    var DEPTH_SCALE = ${SHARED_3D.DEPTH_SCALE};
    var HEIGHT_SCALE = ${SHARED_3D.HEIGHT_SCALE};
    var LANE_X = ${SHARED_3D.LANE_X};
    var LANE_OFFSET = ${SHARED_3D.LANE_OFFSET};
    function worldZ(oldX) { return -(oldX - FCX) * DEPTH_SCALE; }
    function worldY(oldYAbs, roadYOld) { return (roadYOld - oldYAbs) * HEIGHT_SCALE; }
    var BARRIER_GAP = ${SHARED_3D.BARRIER_GAP}; // overhead-gantry slide-under gap ceiling (shared)

    var THEME_COLORS = ${JSON.stringify(SHARED_3D.THEME_COLORS)};

    var OBSTACLE_COLORS = ${JSON.stringify(SHARED_3D.OBSTACLE_COLORS)};
    var OBSTACLE_KIND = ${JSON.stringify(SHARED_3D.OBSTACLE_KIND)};
    var HAT_COLORS = ${JSON.stringify(SHARED_3D.HAT_COLORS)};
    // Neon Synthwave Overdrive finish maps -- mirrors the applyFinish() logic
    // in the web Scene3D.tsx ObstaclePool by hand, since this file hand-rolls
    // its own THREE.js materials instead of sharing React components with web.
    var CHROME_ACCENT = ${JSON.stringify(SHARED_3D.CHROME_ACCENT)};
    var OBSTACLE_GLOW = ${JSON.stringify(SHARED_3D.OBSTACLE_GLOW)};
    var OBSTACLE_METAL = ${JSON.stringify(SHARED_3D.OBSTACLE_METAL)};
    // Real bloom/glow post-processing tuning -- see BLOOM_CONFIG in the
    // shared lib. Web uses full-scene luminance threshold via
    // @react-three/postprocessing; mobile has no access to that library, so
    // it uses layer-based *selective* bloom instead (BLOOM_LAYER): only
    // meshes explicitly tagged onto that Three.js object layer are re-drawn
    // into a small offscreen target, blurred, and additively composited
    // back onto the canvas -- cheap because it never re-renders the ground/
    // props/runner body through the bloom pass, unlike full-scene threshold
    // extraction.
    var BLOOM_CONFIG = ${JSON.stringify(SHARED_3D.BLOOM_CONFIG)};
    var BLOOM_LAYER = ${SHARED_3D.BLOOM_LAYER};

    var N_OBSTACLES = ${SHARED_3D.N_OBSTACLES}, N_PARTICLES = ${SHARED_3D.N_PARTICLES}, N_PUDDLES = ${SHARED_3D.N_PUDDLES};
    var N_COINS = ${SHARED_3D.N_COINS}, N_POWERUPS = ${SHARED_3D.N_POWERUPS};
    var POWERUP_COLORS = ${JSON.stringify(SHARED_3D.POWERUP_COLORS)};
    var COIN_R_3D = 22; // pixel-space coin visual radius (used by 3D updateCoins only)
    var N_PROPS = 16, PROP_SPACING = 14, PROP_SIDE = 3.2;
    var N_DASH = 22, DASH_SPACING = 3.2;
    var ROAD_SURFACE_OFFSET = ${SHARED_3D.ROAD_SURFACE_OFFSET}, FINGER_TIP_OFFSET = ${SHARED_3D.FINGER_TIP_OFFSET};

    var renderer, scene, camera;
    var dirLight, ambLight, hemiLight, neonLight, fog;
    var currentTheme = null;
    var bloom = null; // built lazily in init(); null on WebGL/shader failure (device falls back to no-bloom, not a crash)

    var obs = { groups:[], box:[], cyl:[], cone:[], head:[], accent:[], wheelL:[], wheelR:[] };
    var coins3d = []; // THREE.Mesh pool for coins (cylindrical gold discs)
    var powerUps3d = []; // THREE.Mesh pool for power-ups (octahedrons, color by type)
    var particles = [];
    var puddles = [];
    var dashes = [];
    var roadMesh, shoulderMesh;
    var props = []; // { group, seed, children: { suburbBody, suburbRoof, cityBody, hwyPole, hwyLight, mtnBody, nightBody, nightWindow } }
    var propSeeds = [];

    var runner = {};

    function roadYOld(heightPx) { return heightPx - ROAD_SURFACE_OFFSET; }

    function makeStdMat(color, extra) {
      var opts = Object.assign({ color: color }, extra || {});
      return new THREE.MeshStandardMaterial(opts);
    }

    function buildLighting() {
      ambLight = new THREE.AmbientLight(0xffffff, 0.55);
      scene.add(ambLight);
      dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
      dirLight.position.set(4, 8, 4);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.set(1024, 1024);
      dirLight.shadow.camera.near = 0.5;
      dirLight.shadow.camera.far = 30;
      dirLight.shadow.camera.left = -8;
      dirLight.shadow.camera.right = 8;
      dirLight.shadow.camera.top = 8;
      dirLight.shadow.camera.bottom = -8;
      scene.add(dirLight);
      hemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0.45);
      scene.add(hemiLight);
      // Neon accent rim light -- theme-tinted, mirrors the pointLight added
      // to web Scene3D.tsx's Lighting component for the Neon Synthwave
      // Overdrive redesign.
      neonLight = new THREE.PointLight(0xffffff, 0.6, 14, 2);
      neonLight.position.set(0, 3, -1.5);
      scene.add(neonLight);
      fog = new THREE.Fog(0x000000, 6, 55);
      scene.fog = fog;
    }

    // ---- Bloom (real post-processing glow) -----------------------------
    // Selective bloom via Three.js object layers: only meshes tagged onto
    // BLOOM_LAYER are re-drawn into a small offscreen target each frame,
    // Gaussian-blurred (2-pass separable), then additively composited back
    // onto the canvas. Kept deliberately cheap for low-end phones: the
    // bloom-source render only includes the (few) glow-tagged meshes, and
    // every offscreen target is capped well below screen resolution.
    var BLOOM_RES_SCALE = 0.3, BLOOM_MAX_DIM = 480, BLOOM_MIN_DIM = 64;

    function makeFSQuadMaterial(fragmentShader, uniforms) {
      return new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: fragmentShader,
        depthTest: false,
        depthWrite: false,
      });
    }

    function buildBloom() {
      try {
        var w = Math.min(BLOOM_MAX_DIM, Math.max(BLOOM_MIN_DIM, Math.floor(window.innerWidth * BLOOM_RES_SCALE)));
        var h = Math.min(BLOOM_MAX_DIM, Math.max(BLOOM_MIN_DIM, Math.floor(window.innerHeight * BLOOM_RES_SCALE)));
        var rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false };
        var blurMat = makeFSQuadMaterial(
          "precision mediump float;\\n" +
          "varying vec2 vUv;\\n" +
          "uniform sampler2D tDiffuse;\\n" +
          "uniform vec2 direction;\\n" +
          "void main() {\\n" +
          "  vec4 sum = vec4(0.0);\\n" +
          "  sum += texture2D(tDiffuse, vUv - 4.0 * direction) * 0.0162162162;\\n" +
          "  sum += texture2D(tDiffuse, vUv - 3.0 * direction) * 0.0540540541;\\n" +
          "  sum += texture2D(tDiffuse, vUv - 2.0 * direction) * 0.1216216216;\\n" +
          "  sum += texture2D(tDiffuse, vUv - 1.0 * direction) * 0.1945945946;\\n" +
          "  sum += texture2D(tDiffuse, vUv) * 0.2270270270;\\n" +
          "  sum += texture2D(tDiffuse, vUv + 1.0 * direction) * 0.1945945946;\\n" +
          "  sum += texture2D(tDiffuse, vUv + 2.0 * direction) * 0.1216216216;\\n" +
          "  sum += texture2D(tDiffuse, vUv + 3.0 * direction) * 0.0540540541;\\n" +
          "  sum += texture2D(tDiffuse, vUv + 4.0 * direction) * 0.0162162162;\\n" +
          "  gl_FragColor = sum;\\n" +
          "}",
          { tDiffuse: { value: null }, direction: { value: new THREE.Vector2() } }
        );
        var compositeMat = makeFSQuadMaterial(
          "precision mediump float;\\n" +
          "varying vec2 vUv;\\n" +
          "uniform sampler2D tDiffuse;\\n" +
          "uniform float intensity;\\n" +
          "void main() {\\n" +
          "  vec4 c = texture2D(tDiffuse, vUv);\\n" +
          "  gl_FragColor = vec4(c.rgb * intensity, 1.0);\\n" +
          "}",
          { tDiffuse: { value: null }, intensity: { value: 1.0 } }
        );
        compositeMat.transparent = true;
        compositeMat.blending = THREE.AdditiveBlending;

        var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat);
        var quadScene = new THREE.Scene();
        quadScene.add(quad);
        var quadCamera = new THREE.Camera();

        bloom = {
          width: w, height: h,
          rtScene: new THREE.WebGLRenderTarget(w, h, rtOpts),
          rtBlurA: new THREE.WebGLRenderTarget(w, h, rtOpts),
          rtBlurB: new THREE.WebGLRenderTarget(w, h, rtOpts),
          blurMat: blurMat, compositeMat: compositeMat,
          quad: quad, quadScene: quadScene, quadCamera: quadCamera,
        };
      } catch (e) {
        // Defensive: an offscreen-target/shader failure should never take
        // down the whole 3D layer -- just skip bloom on this device.
        bloom = null;
        console.error("Bloom init failed, glow post-processing disabled:", e);
      }
    }

    function resizeBloom() {
      if (!bloom) return;
      var w = Math.min(BLOOM_MAX_DIM, Math.max(BLOOM_MIN_DIM, Math.floor(window.innerWidth * BLOOM_RES_SCALE)));
      var h = Math.min(BLOOM_MAX_DIM, Math.max(BLOOM_MIN_DIM, Math.floor(window.innerHeight * BLOOM_RES_SCALE)));
      if (w === bloom.width && h === bloom.height) return;
      bloom.width = w; bloom.height = h;
      bloom.rtScene.setSize(w, h);
      bloom.rtBlurA.setSize(w, h);
      bloom.rtBlurB.setSize(w, h);
    }

    function renderBloom() {
      if (!bloom || !renderer) return;
      var savedBg = scene.background, savedFog = scene.fog;
      scene.background = null;
      scene.fog = null;
      camera.layers.disableAll();
      camera.layers.enable(BLOOM_LAYER);
      renderer.setRenderTarget(bloom.rtScene);
      renderer.render(scene, camera);
      camera.layers.enableAll();
      scene.background = savedBg;
      scene.fog = savedFog;

      bloom.quad.material = bloom.blurMat;
      bloom.blurMat.uniforms.tDiffuse.value = bloom.rtScene.texture;
      bloom.blurMat.uniforms.direction.value.set(1 / bloom.width, 0);
      renderer.setRenderTarget(bloom.rtBlurA);
      renderer.render(bloom.quadScene, bloom.quadCamera);

      bloom.blurMat.uniforms.tDiffuse.value = bloom.rtBlurA.texture;
      bloom.blurMat.uniforms.direction.value.set(0, 1 / bloom.height);
      renderer.setRenderTarget(bloom.rtBlurB);
      renderer.render(bloom.quadScene, bloom.quadCamera);

      renderer.setRenderTarget(null);
    }

    function compositeBloom() {
      if (!bloom || !renderer) return;
      var cfg = BLOOM_CONFIG[currentTheme] || BLOOM_CONFIG.suburb;
      bloom.quad.material = bloom.compositeMat;
      bloom.compositeMat.uniforms.tDiffuse.value = bloom.rtBlurB.texture;
      bloom.compositeMat.uniforms.intensity.value = cfg.intensity;
      var prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(bloom.quadScene, bloom.quadCamera);
      renderer.autoClear = prevAutoClear;
    }

    function buildGroundAndRoad() {
      var shoulderGeo = new THREE.PlaneGeometry(40, 320);
      shoulderMesh = new THREE.Mesh(shoulderGeo, makeStdMat("#2f6b3f"));
      shoulderMesh.rotation.x = -Math.PI / 2;
      shoulderMesh.position.set(0, -0.02, -140);
      shoulderMesh.receiveShadow = true;
      scene.add(shoulderMesh);

      var roadGeo = new THREE.PlaneGeometry(3.4, 320);
      roadMesh = new THREE.Mesh(roadGeo, makeStdMat("#2a1f33", { metalness: 0.15, roughness: 0.6 }));
      roadMesh.rotation.x = -Math.PI / 2;
      roadMesh.position.set(0, 0, -140);
      roadMesh.receiveShadow = true;
      scene.add(roadMesh);

      for (var i = 0; i < N_DASH; i++) {
        var dashGeo = new THREE.PlaneGeometry(0.16, 1.1);
        var dashMat = makeStdMat("#eeeeee");
        var dashMesh = new THREE.Mesh(dashGeo, dashMat);
        dashMesh.rotation.x = -Math.PI / 2;
        scene.add(dashMesh);
        dashes.push(dashMesh);
      }
    }

    function buildThemeProps() {
      for (var i = 0; i < N_PROPS; i++) {
        propSeeds.push({
          side: Math.random() < 0.5 ? -1 : 1,
          h: 1.2 + Math.random() * 3,
          w: 0.8 + Math.random() * 0.9,
          baseZ: -(Math.random() * N_PROPS * PROP_SPACING)
        });
        var g = new THREE.Group();
        var body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), makeStdMat("#888888"));
        body.castShadow = true;
        var roof = new THREE.Mesh(new THREE.ConeGeometry(1, 0.6, 4), makeStdMat("#888888"));
        roof.castShadow = true;
        var cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 6), makeStdMat("#888888"));
        cone.castShadow = true;
        var pole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1, 0.18), makeStdMat("#888888"));
        pole.castShadow = true;
        var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), makeStdMat("#ffffff", { emissive: "#ffaa00", emissiveIntensity: 0.8 }));
        var window_ = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02), makeStdMat("#ffdc50", { emissive: "#ffdc50", emissiveIntensity: 1.2 }));
        g.add(body, roof, cone, pole, lamp, window_);
        scene.add(g);
        props.push({ group: g, body: body, roof: roof, cone: cone, pole: pole, lamp: lamp, window: window_ });
      }
    }

    function updateThemeProps(theme) {
      var colors = THEME_COLORS[theme];
      for (var i = 0; i < N_PROPS; i++) {
        var p = props[i];
        p.body.visible = false; p.roof.visible = false; p.cone.visible = false;
        p.pole.visible = false; p.lamp.visible = false; p.window.visible = false;
        var s = propSeeds[i];
        // Props are pooled/reused across theme switches, so each branch must
        // explicitly enable/disable BLOOM_LAYER on the meshes it touches --
        // otherwise a mesh glowing in one theme could stay tagged bloom-lit
        // after switching to a theme where it should be dark.
        p.body.layers.disable(BLOOM_LAYER);
        p.lamp.layers.disable(BLOOM_LAYER);
        p.window.layers.disable(BLOOM_LAYER);
        if (theme === "suburb") {
          p.body.visible = true; p.roof.visible = true;
          p.body.scale.set(s.w, s.h, s.w); p.body.position.set(0, s.h / 2, 0);
          p.body.material.color.set(colors.prop);
          p.roof.scale.set(s.w * 0.75, 1, s.w * 0.75); p.roof.position.set(0, s.h + 0.3, 0);
          p.roof.material.color.set(colors.propAccent);
        } else if (theme === "city") {
          p.body.visible = true;
          p.body.scale.set(s.w, s.h, s.w); p.body.position.set(0, s.h / 2, 0);
          p.body.material.color.set(colors.prop);
          p.body.material.emissive.set(colors.propAccent); p.body.material.emissiveIntensity = 0.18;
          p.body.material.metalness = 0.4; p.body.material.roughness = 0.4;
          p.body.layers.enable(BLOOM_LAYER);
        } else if (theme === "highway") {
          p.pole.visible = true; p.lamp.visible = true;
          p.pole.scale.set(1, s.h * 0.4, 1); p.pole.position.set(0, s.h * 0.2, 0);
          p.pole.material.color.set(colors.prop);
          p.pole.material.metalness = 0.5; p.pole.material.roughness = 0.3;
          p.lamp.position.set(0, s.h * 0.4, 0);
          p.lamp.material.color.set(colors.propAccent);
          p.lamp.material.emissive.set(colors.propAccent); p.lamp.material.emissiveIntensity = 1.1;
          p.lamp.layers.enable(BLOOM_LAYER);
        } else if (theme === "mountain") {
          p.cone.visible = true;
          p.cone.scale.set(s.w * 1.4, s.h, s.w * 1.4); p.cone.position.set(0, s.h / 2, 0);
          p.cone.material.color.set(colors.prop);
        } else {
          p.body.visible = true; p.window.visible = true;
          p.body.scale.set(s.w, s.h, s.w); p.body.position.set(0, s.h / 2, 0);
          p.body.material.color.set(colors.prop);
          p.window.position.set(0, s.h * 0.15, s.w / 2 + 0.01);
          p.window.material.color.set(colors.propAccent);
          p.window.material.emissive.set(colors.propAccent); p.window.material.emissiveIntensity = 1.6;
          p.window.layers.enable(BLOOM_LAYER);
        }
      }
    }

    function buildObstaclePool() {
      for (var i = 0; i < N_OBSTACLES; i++) {
        var g = new THREE.Group();
        g.position.set(0, 0, HIDE_Z);
        var box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), makeStdMat("#888888"));
        box.castShadow = true;
        var cyl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), makeStdMat("#888888"));
        cyl.castShadow = true;
        var cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 10), makeStdMat("#e8720c"));
        cone.castShadow = true;
        var head = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), makeStdMat("#c9a876"));
        head.castShadow = true;
        var accent = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), makeStdMat("#c8c8c8"));
        accent.castShadow = true;
        var wheelL = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 8, 16), makeStdMat("#111111"));
        wheelL.castShadow = true;
        var wheelR = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 8, 16), makeStdMat("#111111"));
        wheelR.castShadow = true;
        g.add(box, cyl, cone, head, accent, wheelL, wheelR);
        scene.add(g);
        obs.groups.push(g); obs.box.push(box); obs.cyl.push(cyl); obs.cone.push(cone);
        obs.head.push(head); obs.accent.push(accent); obs.wheelL.push(wheelL); obs.wheelR.push(wheelR);
      }
    }

    function buildParticlePool() {
      for (var i = 0; i < N_PARTICLES; i++) {
        var mat = new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 1 });
        var m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
        m.position.set(0, 0, HIDE_Z);
        scene.add(m);
        particles.push(m);
      }
    }

    function buildPuddlePool() {
      for (var i = 0; i < N_PUDDLES; i++) {
        var mat = new THREE.MeshStandardMaterial({ color: "#8B0000", transparent: true, opacity: 0.7, depthWrite: false });
        var m = new THREE.Mesh(new THREE.CircleGeometry(1, 20), mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(0, 0, HIDE_Z);
        scene.add(m);
        puddles.push(m);
      }
    }

    // Coin pool — gold flat cylinders (matching web CoinPool's cylinderGeometry).
    // Each coin mesh is tagged BLOOM_LAYER so it glows with the selective-bloom pass.
    function buildCoinPool() {
      for (var i = 0; i < N_COINS; i++) {
        var mat = new THREE.MeshStandardMaterial({ color: "#ffd700", emissive: "#ffaa00", emissiveIntensity: 0.6, metalness: 0.85, roughness: 0.15 });
        var m = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 16), mat);
        m.rotation.x = Math.PI / 2;
        m.castShadow = true;
        m.position.set(0, 0, HIDE_Z);
        m.layers.enable(BLOOM_LAYER);
        scene.add(m);
        coins3d.push(m);
      }
    }

    // Power-up pool — octahedrons (matching web PowerUpPool's octahedronGeometry).
    // Each power-up mesh is tagged BLOOM_LAYER and its color/emissive is set per-frame
    // from POWERUP_COLORS[p.type] (magnet=#ff44ff, shield=#44ddff, multiplier=#ffee00).
    function buildPowerUpPool() {
      for (var i = 0; i < N_POWERUPS; i++) {
        var mat = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.95 });
        var m = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), mat);
        m.castShadow = true;
        m.position.set(0, 0, HIDE_Z);
        m.layers.enable(BLOOM_LAYER);
        scene.add(m);
        powerUps3d.push(m);
      }
    }

    function buildRunner() {
      var group = new THREE.Group();
      scene.add(group);

      function buildFinger() {
        var fg = new THREE.Group();
        var upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 8, 14), makeStdMat("#e8b892", { roughness: 0.7 }));
        upper.castShadow = true; upper.position.set(0, 1.12, 0);
        var knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.205, 16, 12), makeStdMat("#e0ac86", { roughness: 0.7 }));
        knuckle.castShadow = true; knuckle.position.set(0, 0.72, 0);
        var leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.42, 8, 14), makeStdMat("#e8b892", { roughness: 0.7 }));
        leg.castShadow = true; leg.position.set(0, 0.4, 0);
        // Fingernail — rounded/domed rather than a flat box, with a subtle gloss highlight.
        var nail = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10), makeStdMat("#f7ddc4", { metalness: 0.25, roughness: 0.25 }));
        nail.castShadow = true; nail.position.set(0, -0.24, 0.16); nail.rotation.x = -0.3; nail.scale.set(1, 0.85, 0.55);
        // Cute cartoon face (nested on leg) — gives the fingers personality instead of a bare stick.
        var eyeWhiteL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), makeStdMat("#ffffff", { roughness: 0.25 }));
        eyeWhiteL.position.set(-0.08, -0.16, 0.185);
        var eyePupilL = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), makeStdMat("#1a1410", { roughness: 0.4 }));
        eyePupilL.position.set(-0.08, -0.16, 0.225);
        var eyeWhiteR = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), makeStdMat("#ffffff", { roughness: 0.25 }));
        eyeWhiteR.position.set(0.08, -0.16, 0.185);
        var eyePupilR = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), makeStdMat("#1a1410", { roughness: 0.4 }));
        eyePupilR.position.set(0.08, -0.16, 0.225);
        leg.add(nail, eyeWhiteL, eyePupilL, eyeWhiteR, eyePupilR);
        fg.add(upper, knuckle, leg);
        return { group: fg, leg: leg,
          matFinger: [upper.material, leg.material],
          matKnuckle: knuckle.material, matNail: nail.material };
      }

      var handBack = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.32), makeStdMat("#dfae8a", { roughness: 0.7 }));
      handBack.castShadow = true; handBack.position.set(0, 1.62, -0.02);
      var handKnuckle = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), makeStdMat("#dfae8a", { roughness: 0.7 }));
      handKnuckle.position.set(0, 1.62, 0.15);
      group.add(handBack, handKnuckle);

      var leftFinger = buildFinger();
      leftFinger.group.position.x = -0.28;
      var rightFinger = buildFinger();
      rightFinger.group.position.x = 0.28;
      group.add(leftFinger.group, rightFinger.group);

      // Lightsaber — held by the right finger, swings when active.
      // Blade length visually tracks the equipped saber tier's reach (120-185px)
      // so higher-tier sabers look longer, matching the web version.
      // The blade mesh is tagged BLOOM_LAYER so it participates in the
      // selective-bloom pass and glows just like web's neon obstacles/crown.
      var saberGroup = new THREE.Group();
      saberGroup.position.set(0.28, 0.95, 0.18);
      saberGroup.rotation.z = -1.1;
      group.add(saberGroup);
      var saberHilt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.18, 6),
        makeStdMat(CHROME_ACCENT, { metalness: 0.85, roughness: 0.2 })
      );
      saberHilt.castShadow = true; saberHilt.position.set(0, 0.12, 0);
      saberGroup.add(saberHilt);
      var saberBlade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.62, 6),
        makeStdMat("#ff2b2b", { emissive: "#ff6b6b", emissiveIntensity: 0.8 })
      );
      // Blade geometry length (0.62) matches tier-1 reach; updateRunner
      // rescales along Y to match the actual equipped tier.
      saberBlade.position.set(0, 0.47, 0);
      saberBlade.layers.enable(BLOOM_LAYER);
      saberGroup.add(saberBlade);

      var hatGroup = new THREE.Group();
      hatGroup.position.set(0, 1.85, 0.05);
      group.add(hatGroup);

      var hatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 10), makeStdMat(HAT_COLORS.tophat));
      hatTop.castShadow = true;
      var hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 10), makeStdMat(HAT_COLORS.tophat));
      hatBrim.position.set(0, -0.18, 0);
      var tophatGroup = new THREE.Group(); tophatGroup.add(hatTop, hatBrim); hatGroup.add(tophatGroup);

      var capMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), makeStdMat(HAT_COLORS.cap));
      capMesh.castShadow = true; hatGroup.add(capMesh);

      var crownMesh = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.08, 8, 12), makeStdMat(HAT_COLORS.crown, { emissive: "#886600", emissiveIntensity: 0.65, metalness: 0.9, roughness: 0.15 }));
      crownMesh.castShadow = true; crownMesh.layers.enable(BLOOM_LAYER); hatGroup.add(crownMesh);

      var cowboyMesh = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 10), makeStdMat(HAT_COLORS.cowboy));
      cowboyMesh.castShadow = true; hatGroup.add(cowboyMesh);

      var vikingGroup = new THREE.Group();
      var vikingDome = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), makeStdMat(HAT_COLORS.viking));
      vikingDome.castShadow = true;
      var hornL = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 6), makeStdMat("#e8e0c8"));
      hornL.position.set(-0.24, 0, 0); hornL.rotation.z = 0.6;
      var hornR = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 6), makeStdMat("#e8e0c8"));
      hornR.position.set(0.24, 0, 0); hornR.rotation.z = -0.6;
      vikingGroup.add(vikingDome, hornL, hornR);
      hatGroup.add(vikingGroup);

      runner = {
        group: group, leftFinger: leftFinger, rightFinger: rightFinger, hatGroup: hatGroup,
        hats: { tophat: tophatGroup, cap: capMesh, crown: crownMesh, cowboy: cowboyMesh, viking: vikingGroup },
        saberGroup: saberGroup, saberBlade: saberBlade,
        // Skin material refs so the selected character can re-tint the placeholder
        // body without rebuilding the mesh (see applyCharacterSkin).
        skinMats: {
          backHand: [handBack.material, handKnuckle.material],
          finger: [leftFinger.matFinger[0], leftFinger.matFinger[1], rightFinger.matFinger[0], rightFinger.matFinger[1]],
          knuckle: [leftFinger.matKnuckle, rightFinger.matKnuckle],
          nail: [leftFinger.matNail, rightFinger.matNail]
        },
        skinCharId: null
      };
    }

    // Re-tints the placeholder finger body to the selected character's palette.
    // Guarded by skinCharId so material colors are only rewritten on change.
    function applyCharacterSkin(charId) {
      if (!runner || !runner.skinMats) return;
      var id = charId || DEFAULT_CHARACTER;
      if (runner.skinCharId === id) return;
      runner.skinCharId = id;
      var cdef = getCharacterDef(id);
      var sm = runner.skinMats, k;
      for (k = 0; k < sm.backHand.length; k++) sm.backHand[k].color.set(cdef.backHand);
      for (k = 0; k < sm.finger.length; k++) sm.finger[k].color.set(cdef.finger);
      for (k = 0; k < sm.knuckle.length; k++) sm.knuckle[k].color.set(cdef.knuckle);
      for (k = 0; k < sm.nail.length; k++) sm.nail[k].color.set(cdef.nail);
    }

    function updateCamera(st) {
      var bob = st.gameRunning ? Math.max(0, -st.velocity) * 0.02 : 0;
      var shakeX = st.shake > 0 ? (Math.random() - 0.5) * st.shake * 0.02 : 0;
      camera.position.set(shakeX, 2.35 + bob * 0.12, 5.4);
      camera.lookAt(0, 1.1 + bob * 0.12, -2.5);
    }

    function updateGroundAndRoad(st) {
      var range = N_DASH * DASH_SPACING;
      for (var i = 0; i < N_DASH; i++) {
        var z = -(i * DASH_SPACING) + st.worldScroll * DEPTH_SCALE;
        z = ((z % range) + range) % range - range;
        dashes[i].position.set(0, 0.011, z);
      }
    }

    function updatePropsScroll(st) {
      var range = N_PROPS * PROP_SPACING;
      for (var i = 0; i < N_PROPS; i++) {
        var s = propSeeds[i];
        var z = s.baseZ + st.worldScroll * DEPTH_SCALE;
        z = ((z % range) + range) % range - range;
        props[i].group.position.set(s.side * PROP_SIDE, 0, z);
      }
    }

    // Applies the theme's glow/chrome finish to an obstacle mesh's material,
    // mirroring applyFinish() in web Scene3D.tsx's ObstaclePool.
    function applyFinish(mesh, type, color) {
      var mat = mesh.material;
      if (OBSTACLE_GLOW[type]) {
        mat.emissive.set(color);
        mat.emissiveIntensity = 0.35;
        mesh.layers.enable(BLOOM_LAYER);
      } else {
        mat.emissive.set("#000000");
        mat.emissiveIntensity = 0;
        mesh.layers.disable(BLOOM_LAYER);
      }
      if (OBSTACLE_METAL[type]) {
        mat.metalness = 0.75;
        mat.roughness = 0.25;
      } else {
        mat.metalness = 0;
        mat.roughness = 1;
      }
    }

    function updateObstacles(st, roadY) {
      for (var i = 0; i < N_OBSTACLES; i++) {
        var g = obs.groups[i];
        var o = st.obstacles[i];
        if (!o) { g.position.set(0, 0, HIDE_Z); continue; }
        var w = Math.max(0.5, o.obsWidth * 0.028);
        var h = Math.max(0.4, o.obsHeight * 0.02);
        var kind = OBSTACLE_KIND[o.type] || "box";
        var color = OBSTACLE_COLORS[o.type] || "#888888";
        g.position.set(LANE_X + o.lane * LANE_OFFSET, 0, worldZ(o.x + o.obsWidth / 2));

        var box = obs.box[i], cyl = obs.cyl[i], cone = obs.cone[i], head = obs.head[i], accent = obs.accent[i], wl = obs.wheelL[i], wr = obs.wheelR[i];
        box.visible = kind === "box" || kind === "animal" || kind === "bicycle" || kind === "barrier";
        cyl.visible = kind === "cylinder" || kind === "sign" || kind === "barrier";
        cone.visible = kind === "cone";
        head.visible = kind === "animal";
        accent.visible = kind === "sign" || kind === "barrier" || (kind === "cylinder" && (o.type === "hydrant" || o.type === "trashcan"));
        wl.visible = kind === "bicycle";
        wr.visible = kind === "bicycle";

        if (kind === "box") {
          box.scale.set(w, h, 0.5); box.position.set(0, h / 2, 0); box.material.color.set(color);
          applyFinish(box, o.type, color);
        } else if (kind === "cylinder") {
          cyl.scale.set(w * 0.5, h, w * 0.5); cyl.position.set(0, h / 2, 0); cyl.material.color.set(color);
          applyFinish(cyl, o.type, color);
          if (accent.visible) {
            accent.position.set(0, h + 0.06, 0); accent.scale.set(w * 0.65, 0.12, w * 0.65);
            accent.material.color.set(CHROME_ACCENT);
            accent.material.metalness = 0.85; accent.material.roughness = 0.2;
            // Chrome accent ring, never glows here (unlike the sign branch's
            // red accent below) -- must explicitly clear any bloom/emissive
            // state left over from this pooled mesh's last use as a sign.
            accent.material.emissive.set("#000000"); accent.material.emissiveIntensity = 0;
            accent.layers.disable(BLOOM_LAYER);
          }
        } else if (kind === "cone") {
          cone.scale.set(w * 0.5, h, w * 0.5); cone.position.set(0, h / 2, 0); cone.material.color.set(color);
          applyFinish(cone, o.type, color);
        } else if (kind === "animal") {
          box.scale.set(w, h * 0.65, 0.42); box.position.set(0, h * 0.32, 0); box.material.color.set(color);
          box.material.emissive.set("#000000"); box.material.emissiveIntensity = 0;
          box.material.metalness = 0; box.material.roughness = 1;
          box.layers.disable(BLOOM_LAYER);
          head.position.set(0, h * 0.72, 0.18); head.scale.setScalar(Math.max(0.14, h * 0.32));
          head.material.color.set(o.type === "cat" ? "#c9a876" : "#5a3b1e");
        } else if (kind === "bicycle") {
          box.scale.set(w, h * 0.16, 0.14); box.position.set(0, h * 0.55, 0); box.material.color.set(color);
          applyFinish(box, o.type, color);
          wl.position.set(-w * 0.32, h * 0.28, 0); wr.position.set(w * 0.32, h * 0.28, 0);
          wl.scale.setScalar(h * 0.28); wr.scale.setScalar(h * 0.28);
        } else if (kind === "sign") {
          cyl.scale.set(0.05, h, 0.05); cyl.position.set(0, h / 2, 0);
          cyl.material.color.set(CHROME_ACCENT); cyl.material.metalness = 0.85; cyl.material.roughness = 0.2;
          // Chrome pole, never glows here (unlike the cylinder branch's
          // hydrant/trashcan use of this same pooled mesh) -- must
          // explicitly clear any bloom/emissive state left over from that.
          cyl.material.emissive.set("#000000"); cyl.material.emissiveIntensity = 0;
          cyl.layers.disable(BLOOM_LAYER);
          accent.position.set(0, h * 0.92, 0); accent.rotation.set(0, 0, Math.PI / 8);
          accent.scale.set(w * 0.6, 0.08, w * 0.6); accent.material.color.set("#c62828");
          applyFinish(accent, o.type, "#c62828");
        } else if (kind === "barrier") {
          // Overhead neon gantry: beam hung at the BARRIER_GAP slide-under
          // ceiling (box) + two side posts (cyl left, accent right) down to
          // the road. Mirrors web Scene3D.tsx ObstaclePool barrier branch.
          var gapWorld = worldY(roadY - BARRIER_GAP, roadY);
          var beamThick = 0.34, beamW = 1.3, postW = 0.14;
          var postH = gapWorld + beamThick;
          box.scale.set(beamW, beamThick, 0.5); box.position.set(0, gapWorld + beamThick / 2, 0); box.material.color.set(color);
          applyFinish(box, o.type, color);
          cyl.scale.set(postW, postH, postW); cyl.position.set(-beamW / 2 + postW / 2, postH / 2, 0); cyl.material.color.set(color);
          applyFinish(cyl, o.type, color);
          accent.rotation.set(0, 0, 0);
          accent.scale.set(postW, postH, postW); accent.position.set(beamW / 2 - postW / 2, postH / 2, 0); accent.material.color.set(color);
          applyFinish(accent, o.type, color);
        }
      }
    }

    function updateParticles(st, roadY) {
      for (var i = 0; i < N_PARTICLES; i++) {
        var m = particles[i];
        var p = st.particles[i];
        if (!p) { m.position.set(0, 0, HIDE_Z); continue; }
        var s = Math.max(0.03, (p.size || 6) * 0.014);
        m.position.set(LANE_X, worldY(p.y, roadY), worldZ(p.x < 0 ? 0 : p.x) - 0.02 * i);
        m.scale.setScalar(s);
        var alpha = Math.max(0.05, p.life / 70);
        m.material.color.set(p.color);
        m.material.opacity = alpha;
      }
    }

    function updatePuddles(st, roadY) {
      for (var i = 0; i < N_PUDDLES; i++) {
        var m = puddles[i];
        var bp = st.bloodPuddles[i];
        if (!bp) { m.position.set(0, 0, HIDE_Z); continue; }
        m.position.set(LANE_X, 0.01, worldZ(bp.x));
        m.scale.set(bp.rx * 0.03, bp.ry * 0.03, 1);
        m.material.opacity = Math.min(0.8, (bp.life / bp.maxLife) * 0.8);
      }
    }

    // Coin 3D update — mirrors web CoinPool useFrame: bob vertically, rotate Y,
    // park hidden coins at HIDE_Z. Coins are on BLOOM_LAYER (tagged at build time).
    function updateCoins(st, roadY) {
      for (var i = 0; i < N_COINS; i++) {
        var m = coins3d[i];
        var c = st.coins ? st.coins[i] : undefined;
        if (!c) { m.position.set(0, 0, HIDE_Z); continue; }
        var bobY = worldY(c.y, roadY) + Math.sin(st.time * 0.15 + (c.phase || 0)) * 0.08;
        m.position.set(LANE_X, bobY, worldZ(c.x));
        m.rotation.z += 0.1; // ~6 rad/s at 60fps (web uses delta*6)
      }
    }

    // Power-up 3D update — mirrors web PowerUpPool useFrame: rotate Y, set color
    // from POWERUP_COLORS[p.type], park hidden slots at HIDE_Z.
    // Power-ups are on BLOOM_LAYER (tagged at build time).
    function updatePowerUps(st, roadY) {
      for (var i = 0; i < N_POWERUPS; i++) {
        var m = powerUps3d[i];
        var p = st.powerUps ? st.powerUps[i] : undefined;
        if (!p) { m.position.set(0, 0, HIDE_Z); continue; }
        m.position.set(LANE_X, worldY(p.y, roadY), worldZ(p.x));
        m.rotation.y += 0.05; // ~3 rad/s at 60fps (web uses delta*3)
        var col = POWERUP_COLORS[p.type] || "#ffffff";
        m.material.color.set(col);
        m.material.emissive.set(col);
        m.material.metalness = 0.5; m.material.roughness = 0.2;
      }
    }

    function updateRunner(st, roadY, hatId, saberTier, charId) {
      applyCharacterSkin(charId);
      var stretchY = 1, stretchX = 1;
      if (st.gameRunning && !st.onGround) {
        stretchY = 1 + Math.max(-0.10, Math.min(0.16, -st.velocity * 0.011));
        stretchX = 1 - (stretchY - 1) * 0.55;
      }
      if (st.landImpact > 0) {
        var k = st.landImpact / 10;
        stretchY = 1 - 0.26 * k;
        stretchX = 1 + 0.26 * k;
      }
      if (st.gameRunning && st.sliding) {
        // Duck/slide: squash low and wide so the runner clearly ducks the beam.
        stretchY = 0.5;
        stretchX = 1.28;
      }
      var footY = worldY(st.playerY + FINGER_TIP_OFFSET, roadY);
      runner.group.position.set(LANE_X + st.laneVisual * LANE_OFFSET, footY, worldZ(FCX));
      runner.group.scale.set(stretchX, stretchY, stretchX);
      runner.group.rotation.x = (st.gameRunning && st.sliding) ? 0.55 : 0; // forward slide lean
      if (st.shake > 0) runner.group.position.x += (Math.random() - 0.5) * st.shake * 0.01;

      var running = st.gameRunning && st.onGround;
      var runPhase = st.time * 0.35;
      var legSwing = running ? Math.sin(runPhase) * 0.55 : (st.onGround ? 0 : 0.35);
      runner.leftFinger.leg.rotation.x = legSwing;
      runner.rightFinger.leg.rotation.x = -legSwing;

      // Saber blade — update color/glow from equipped tier and scale blade
      // length to match the tier's reach (120-185px -> ~0.62-1.05 world units),
      // mirroring web Scene3D.tsx Runner bladeLen formula.
      var sdef = getSaberDef(saberTier || 1);
      var cdef = getCharacterDef(charId || DEFAULT_CHARACTER);
      var bladeLen = 0.62 + ((sdef.reach - 120) / (185 - 120)) * 0.43;
      var bladeHalfLen = bladeLen / 2 + 0.16;
      runner.saberBlade.scale.y = bladeLen / 0.62; // 0.62 is the base geometry length
      runner.saberBlade.position.y = bladeHalfLen;
      var bmat = runner.saberBlade.material;
      // Blade LENGTH tracks the equipped saber tier's reach; blade COLOR/GLOW
      // comes from the selected character (mirrors web Scene3D saber prop).
      bmat.color.set(cdef.saberColor);
      bmat.emissive.set(cdef.saberGlow);
      // Gentle idle pulse matching web's emissiveIntensity=0.8 idle value;
      // runner.saberBlade is always tagged BLOOM_LAYER (set in buildRunner).
      bmat.emissiveIntensity = 0.8 + Math.sin(st.time * 0.08) * 0.15;

      for (var id in runner.hats) {
        if (Object.prototype.hasOwnProperty.call(runner.hats, id)) runner.hats[id].visible = id === hatId;
      }
    }

    function setTheme(theme) {
      if (!renderer) return;
      if (theme === currentTheme) return;
      currentTheme = theme;
      var c = THEME_COLORS[theme];
      dirLight.color.set(c.sun); dirLight.intensity = c.sunIntensity;
      ambLight.color.set(c.ambient);
      hemiLight.color.set(c.sky); hemiLight.groundColor.set(c.road);
      fog.color.set(c.fog); fog.near = 6; fog.far = theme === "night" ? 40 : 55;
      scene.background = new THREE.Color(c.sky);
      shoulderMesh.material.color.set(c.shoulder);
      roadMesh.material.color.set(c.road);
      neonLight.color.set(c.propAccent);
      for (var i = 0; i < N_DASH; i++) {
        dashes[i].material.emissive.set(c.propAccent);
        dashes[i].material.emissiveIntensity = 0.15;
      }
      updateThemeProps(theme);
    }

    function init() {
      try {
        var canvasEl = document.getElementById("c3d");
        renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: false, alpha: true, powerPreference: "default", failIfMajorPerformanceCaveat: false });
        renderer.setPixelRatio(Math.max(1, Math.min(window.devicePixelRatio || 1, 1.6)));
        renderer.shadowMap.enabled = true;
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(62, 1, 0.1, 80);
        camera.position.set(0, 2.35, 5.4);

        buildLighting();
        buildGroundAndRoad();
        buildThemeProps();
        buildRunner();
        buildObstaclePool();
        buildCoinPool();
        buildPowerUpPool();
        buildParticlePool();
        buildPuddlePool();
        buildBloom();
        resize();
      } catch (e) {
        // Defensive: on devices/environments without a usable WebGL context,
        // fall back gracefully instead of aborting the whole script (which
        // would also break the unrelated physics/HUD/persistence logic below).
        renderer = null;
        console.error("Scene3D init failed, 3D layer disabled:", e);
      }
    }

    function resize() {
      var w = window.innerWidth, h = window.innerHeight;
      if (!renderer) return;
      renderer.setSize(w, h, true);
      camera.aspect = w / (h || 1);
      camera.updateProjectionMatrix();
      resizeBloom();
    }

    function update(st, width, height, hatId, saberTier, charId) {
      if (!renderer) return;
      var roadY = roadYOld(height);
      updateCamera(st);
      updateGroundAndRoad(st);
      updatePropsScroll(st);
      updateObstacles(st, roadY);
      updateCoins(st, roadY);
      updatePowerUps(st, roadY);
      updateParticles(st, roadY);
      updatePuddles(st, roadY);
      updateRunner(st, roadY, hatId, saberTier, charId);
    }

    function render() {
      if (!renderer) return;
      renderBloom();
      renderer.render(scene, camera);
      compositeBloom();
    }

    return { init: init, resize: resize, setTheme: setTheme, update: update, render: render };
  })();

  // ---- Speech bubble (DOM) ---------------------------------------------------
  var dialogBubbleEl = document.getElementById("dialogBubble");


  // ---- Canvas + loop --------------------------------------------------------
  var canvas = document.getElementById("c");
  var ctx = canvas.getContext("2d");
  var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  var VW = 0, VH = 0;

  Scene3D.init();

  function resize() {
    VW = window.innerWidth;
    VH = window.innerHeight;
    canvas.style.width = VW + "px";
    canvas.style.height = VH + "px";
    canvas.width = Math.round(VW * dpr);
    canvas.height = Math.round(VH * dpr);
    if (!st.gameRunning) st.playerY = getGroundY(VH);
    Scene3D.resize();
  }
  resize();
  window.addEventListener("resize", resize);

  function loop() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var width = VW; var height = VH;
    var groundY = getGroundY(height);
    var roadY = height - ROAD_SURFACE_OFFSET;
    var lvlDef = getLevelDef(st.currentLevel);
    var theme = lvlDef.theme;
    var i, p, bp;

    if (st.gameRunning) {
      st.time++;
      var scoreGain = 0.6;
      st.levelScore += scoreGain;
      st.totalScore += scoreGain;

      if (st.levelScore >= lvlDef.target) { levelCompleteEvent(); }

      var g = GRAVITY;
      if (st.velocity < 0 && !st.jumpHeld) g *= LOW_JUMP_GRAVITY_MULT;
      else if (st.velocity > 0) g *= FALL_GRAVITY_MULT;
      st.velocity += g;
      if (st.velocity > MAX_FALL) st.velocity = MAX_FALL;
      st.playerY += st.velocity;

      var wasAir = !st.onGround;
      if (st.playerY >= groundY) {
        if (wasAir && st.velocity > 7) {
          st.landImpact = 10;
          st.shake = Math.max(st.shake, 4);
          spawnDust(7, 9);
        }
        st.playerY = groundY; st.velocity = 0; st.onGround = true;
        st.jumpsUsed = 0; st.coyoteTimer = COYOTE_FRAMES;
        // Auto-duck the instant we touch down from an air-slide dive.
        if (st.slideQueued) { st.sliding = true; st.slideTimer = SLIDE_FRAMES; st.slideQueued = false; spawnDust(6, 8); }
      } else {
        st.onGround = false;
        if (st.coyoteTimer > 0) st.coyoteTimer--;
      }
      if (st.playerY < 30) { st.playerY = 30; st.velocity = 1; }

      if (st.jumpBuffer > 0) {
        st.jumpBuffer--;
        if (st.onGround) { doJump(false); st.jumpBuffer = 0; }
      }
      if (st.landImpact > 0) st.landImpact--;
      // Slide/duck countdown — end the ducked pose after SLIDE_FRAMES.
      if (st.sliding) { st.slideTimer--; if (st.slideTimer <= 0) { st.sliding = false; st.slideTimer = 0; } }

      if (st.dialog && st.dialog.life > 0) st.dialog.life--;
      st.dialogCooldown--;
      if (st.dialogCooldown <= 0 && (!st.dialog || st.dialog.life <= 0)) {
        showDialog(pick(RUN_QUIPS), 130);
        st.dialogCooldown = 260 + Math.floor(Math.random() * 220);
      }
      if (st.shake > 0) { st.shake *= 0.86; if (st.shake < 0.4) st.shake = 0; }

      // Ease the visual lane position toward the logical lane (render-only;
      // collision always uses the instant st.lane, never laneVisual).
      st.laneVisual += (st.lane - st.laneVisual) * 0.28;

      st.spawnTimer++;
      var spawnRate = Math.max(lvlDef.minSpawn, 220 - Math.floor(st.levelScore / 6));
      if (st.spawnTimer > spawnRate) { spawnObstacle(width); st.spawnTimer = 0; }

      var fingerLeft = 168; var fingerRight = 202;
      var fingerTipY = st.playerY + FINGER_TIP_OFFSET - 8;
      if (st.boostTimer > 0) st.boostTimer--;
      if (st.boostCooldown > 0) st.boostCooldown--;
      var boostMult = st.boostTimer > 0 ? BOOST_MULT : 1;
      var speed = (BASE_SPEED * lvlDef.speedMult + st.levelScore * 0.001) * boostMult;
      st.worldScroll += speed; // visual-only: drives 3D background/road scroll, no gameplay effect
      // Fart-boost green gas trail. shape "gas" + upward vy so it floats and is
      // NOT pinned by the road floor-clamp (which only clamps shape "circle").
      if (st.boostTimer > 0) {
        var gasBaseY = st.playerY + FINGER_TIP_OFFSET - 6;
        for (var gpi = 0; gpi < 2; gpi++) {
          if (st.particles.length < N_PARTICLES_CAP) {
            st.particles.push({
              x: 185 + (Math.random() - 0.5) * 16, y: gasBaseY + Math.random() * 10,
              vx: 1.1 + Math.random() * 1.8, vy: -(0.7 + Math.random() * 1.3),
              life: 28 + Math.floor(Math.random() * 12), size: 5 + Math.random() * 5,
              color: BOOST_GAS_COLORS[Math.floor(Math.random() * BOOST_GAS_COLORS.length)], shape: "gas"
            });
          }
        }
      }
      var didCrash = false;
      for (i = st.obstacles.length - 1; i >= 0; i--) {
        var o = st.obstacles[i];
        o.x -= speed;
        if (!didCrash && o.lane === st.lane) {
          var xOverlap = fingerRight > o.x && fingerLeft < o.x + o.obsWidth;
          var hit;
          if (o.type === "barrier") {
            // Overhead beam: crash if the head pokes above the gap ceiling
            // (standing or jumping into it); sliding drops the head below.
            var headY = st.sliding ? st.playerY + SLIDE_DUCK : st.playerY;
            hit = xOverlap && headY < roadY - BARRIER_GAP;
          } else {
            hit = xOverlap && fingerTipY > roadY - o.obsHeight;
          }
          if (hit) { crash(); didCrash = true; }
        }
        if (!o.passed && o.x + o.obsWidth * 0.55 < fingerLeft) o.passed = true;
        if (o.x < -150) st.obstacles.splice(i, 1);
      }

      // Coins -- spawn, move, collect on overlap with the finger.
      // Mirrors web Game.tsx coin logic: single coin or short row at various heights.
      st.coinSpawnTimer++;
      if (st.coinSpawnTimer > 90 + Math.random() * 70) {
        st.coinSpawnTimer = 0;
        var coinHeights = [roadY - 46, roadY - 120, roadY - 196];
        var baseY = coinHeights[Math.floor(Math.random() * coinHeights.length)];
        var nCoins = 1 + Math.floor(Math.random() * 3);
        for (var ci = 0; ci < nCoins; ci++) {
          if (st.coins.length < N_COINS_CAP) {
            st.coins.push({ x: width + 40 + ci * 40, y: baseY, phase: Math.random() * Math.PI * 2 });
          }
        }
      }
      var coinTop = st.playerY - 18;
      var coinBottom = st.playerY + FINGER_TIP_OFFSET;
      for (i = st.coins.length - 1; i >= 0; i--) {
        var c = st.coins[i];
        c.x -= speed;
        if (c.x + COIN_R > 156 && c.x - COIN_R < 214 && c.y + COIN_R > coinTop && c.y - COIN_R < coinBottom) {
          for (var cs = 0; cs < 8; cs++) {
            var ca = Math.random() * Math.PI * 2; var csp = 2 + Math.random() * 3;
            if (st.particles.length < N_PARTICLES_CAP) {
              st.particles.push({ x: c.x, y: c.y, vx: Math.cos(ca) * csp, vy: Math.sin(ca) * csp - 1.2, life: 22 + Math.floor(Math.random() * 12), size: 3 + Math.random() * 4, color: "#ffe27a", shape: "circle" });
            }
          }
          st.coinBalance += 1;
          setTotalCoins(st.coinBalance);
          st.coins.splice(i, 1);
          continue;
        }
        if (c.x < -40) st.coins.splice(i, 1);
      }

      // Power-ups -- spawn, move, collect on overlap with the finger.
      // Mirrors web Game.tsx power-up logic (magnet/shield/multiplier).
      st.powerUpSpawnTimer++;
      if (st.powerUpSpawnTimer > 560 + Math.random() * 420) {
        st.powerUpSpawnTimer = 0;
        var puTypes = ["magnet", "shield", "multiplier"];
        var puType = puTypes[Math.floor(Math.random() * puTypes.length)];
        var puHeights = [roadY - 70, roadY - 150];
        var puY = puHeights[Math.floor(Math.random() * puHeights.length)];
        if (st.powerUps.length < N_POWERUPS_CAP) {
          st.powerUps.push({ x: width + 60, y: puY, type: puType, phase: Math.random() * Math.PI * 2 });
        }
      }
      for (i = st.powerUps.length - 1; i >= 0; i--) {
        var pu = st.powerUps[i];
        pu.x -= speed;
        if (pu.x + 20 > 150 && pu.x - 20 < 220 && pu.y + 20 > coinTop - 10 && pu.y - 20 < coinBottom + 10) {
          st.powerUps.splice(i, 1);
          continue;
        }
        if (pu.x < -60) st.powerUps.splice(i, 1);
      }

      for (i = st.particles.length - 1; i >= 0; i--) {
        p = st.particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.life--;
        if (p.rot !== undefined && p.rotV !== undefined) p.rot += p.rotV;
        if (p.shape === "circle" && p.y >= roadY - 6) { p.y = roadY - 6; p.vy = 0; p.vx *= 0.7; }
        if (p.life <= 0) st.particles.splice(i, 1);
      }
      var scrollSpeed = (BASE_SPEED * lvlDef.speedMult + st.levelScore * 0.001) * boostMult;
      for (i = st.bloodPuddles.length - 1; i >= 0; i--) {
        bp = st.bloodPuddles[i];
        bp.x -= scrollSpeed;
        bp.life--;
        if (bp.life <= 0 || bp.x < -200) st.bloodPuddles.splice(i, 1);
      }
      if (st.crashFlash > 0) st.crashFlash--;
    } else {
      st.time++;
      if (st.crashFlash > 0) st.crashFlash--;
      if (st.dialog && st.dialog.life > 0) st.dialog.life--;
      if (st.shake > 0) { st.shake *= 0.86; if (st.shake < 0.4) st.shake = 0; }
      for (i = st.particles.length - 1; i >= 0; i--) {
        p = st.particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.life--;
        if (p.rot !== undefined && p.rotV !== undefined) p.rot += p.rotV;
        if (p.shape === "circle" && p.y >= roadY - 6) { p.y = roadY - 6; p.vy = 0; p.vx *= 0.7; }
        if (p.life <= 0) st.particles.splice(i, 1);
      }
      var scrollSpeed2 = BASE_SPEED * getLevelDef(st.currentLevel).speedMult;
      for (i = st.bloodPuddles.length - 1; i >= 0; i--) {
        bp = st.bloodPuddles[i];
        bp.x -= scrollSpeed2 * 0.2;
        bp.life--;
        if (bp.life <= 0 || bp.x < -200) st.bloodPuddles.splice(i, 1);
      }
      if (!st.gameRunning) st.playerY = getGroundY(height);
    }

    // ---- Draw (3D world layer + 2D HUD-only overlay) ----
    Scene3D.setTheme(theme);
    var hat = getEquippedHat();
    Scene3D.update(st, width, height, hat, getEquippedSaber(), getSelectedCharacter());
    Scene3D.render();
    updateFartBtn();

    ctx.clearRect(0, 0, width, height);

    if (st.dialog && st.dialog.life > 0) {
      var d = st.dialog;
      var fadeIn = Math.min(1, (d.maxLife - d.life) / 8);
      var fadeOut = Math.min(1, d.life / 20);
      dialogBubbleEl.textContent = d.text;
      dialogBubbleEl.style.opacity = String(Math.max(0, Math.min(fadeIn, fadeOut)));
    } else {
      dialogBubbleEl.style.opacity = "0";
    }

    // HUD
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 6;
    ctx.fillStyle = theme === "night" ? "#ffd700" : "#fff";
    ctx.font = "bold 52px Arial"; ctx.textAlign = "left";
    ctx.fillText(String(Math.floor(st.levelScore)), 38, 74);
    ctx.font = "bold 20px Arial";
    ctx.fillText("BEST " + st.bestScore, 40, 102);

    var lvlText = "LVL " + st.currentLevel;
    ctx.font = "bold 18px Arial"; ctx.textAlign = "center";
    var lvlW = ctx.measureText(lvlText).width + 28;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.roundRect(38, 112, lvlW, 28, 8); ctx.fill();
    ctx.fillStyle = "#ffd700"; ctx.shadowBlur = 0; ctx.fillText(lvlText, 38 + lvlW / 2, 131);

    var progress = Math.min(1, st.levelScore / lvlDef.target);
    var barW = 180; var barX = 38; var barY = 145;
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.roundRect(barX, barY, barW, 8, 4); ctx.fill();
    var barGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    barGrad.addColorStop(0, "#4eff91"); barGrad.addColorStop(1, "#00c853");
    ctx.fillStyle = barGrad; ctx.beginPath(); ctx.roundRect(barX, barY, barW * progress, 8, 4); ctx.fill();

    // Coin counter — shows progress toward the next saber unlock
    var nextSaberTier = getHighestOwnedSaber() + 1;
    var coinHudText = nextSaberTier <= SABERS.length
      ? "\\u2605 " + st.coinBalance + " / " + SABERS[nextSaberTier - 1].cost
      : "\\u2605 " + st.coinBalance;
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 6;
    ctx.fillStyle = "#ffd700"; ctx.font = "bold 22px Arial"; ctx.textAlign = "right";
    ctx.fillText(coinHudText, width - 18, 90);
    ctx.shadowBlur = 0;

    if (!st.gameRunning && !st.levelComplete && st.totalScore > 0) {
      var bonusRows = st.lastRunBonus > 0 ? 1 : 0;
      var panelH = 290 + bonusRows * 28;
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.beginPath(); ctx.roundRect(width / 2 - 250, height / 2 - 145, 500, panelH, 20); ctx.fill();
      ctx.fillStyle = "#ff6b6b"; ctx.textAlign = "center";
      ctx.font = "bold 48px Arial"; ctx.fillText("OUCH! \\uD83E\\uDD15", width / 2, height / 2 - 70);
      ctx.fillStyle = "#fff"; ctx.font = "bold 26px Arial";
      ctx.fillText("Level " + st.currentLevel + ": " + Math.floor(st.levelScore) + " / " + lvlDef.target, width / 2, height / 2 - 26);
      ctx.fillStyle = "#aaa"; ctx.font = "20px Arial";
      ctx.fillText("Total distance: " + Math.floor(st.totalScore), width / 2, height / 2 + 10);
      if (st.lastRunBonus > 0) {
        ctx.fillStyle = "#4eff91"; ctx.font = "bold 20px Arial";
        ctx.fillText("+" + st.lastRunBonus + " bonus \\uD83E\\uDE99 (run reward)", width / 2, height / 2 + 36);
      }
      var recordY = height / 2 + (bonusRows > 0 ? 66 : 48);
      if (Math.floor(st.totalScore) >= st.bestScore && st.totalScore > 5) {
        ctx.fillStyle = "#ffd700"; ctx.font = "bold 24px Arial"; ctx.fillText("\\u2605 NEW RECORD! \\u2605", width / 2, recordY);
      }
      ctx.fillStyle = "#ddd"; ctx.font = "20px Arial";
      ctx.fillText("Tap to retry this level", width / 2, height / 2 + 110 + bonusRows * 28);
    }

    if (st.crashFlash > 0) {
      var flashAlpha = (st.crashFlash / 28) * 0.55;
      ctx.fillStyle = "rgba(180,0,0," + flashAlpha + ")";
      ctx.fillRect(0, 0, width, height);
    }

    requestAnimationFrame(loop);
  }

  // ---- Input ----------------------------------------------------------------
  function handleCanvasTap() {
    if (st.gameRunning) { jump(); }
    else if (!st.levelComplete && st.totalScore > 0) { startLevel(st.currentLevel); }
  }
  // Commit-on-threshold gesture (mirrors web Game.tsx touch handlers): a
  // pointerdown only records the origin -- it no longer fires a jump. Dragging
  // past SWIPE_THRESHOLD on the dominant axis commits swipe up=jump (held for
  // variable height), down=slide, left/right=lane, and consumes the gesture. A
  // release that never crossed the threshold counts as a tap (jump / retry).
  var touch = { active: false, startX: 0, startY: 0, consumed: false };
  canvas.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    touch.active = true; touch.startX = e.clientX; touch.startY = e.clientY; touch.consumed = false;
  }, { passive: false });
  canvas.addEventListener("pointermove", function (e) {
    if (!touch.active || touch.consumed) return;
    var dx = e.clientX - touch.startX; var dy = e.clientY - touch.startY;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;
    touch.consumed = true;
    if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
    else if (dy < 0) { if (st.gameRunning) jump(); }
    else slide();
  }, { passive: false });
  canvas.addEventListener("pointerup", function (e) {
    e.preventDefault();
    var wasConsumed = touch.consumed;
    touch.active = false; touch.consumed = true;
    releaseJump();
    if (!wasConsumed) handleCanvasTap(); // pure tap
  }, { passive: false });
  canvas.addEventListener("pointercancel", function () { touch.active = false; touch.consumed = true; releaseJump(); });
  canvas.addEventListener("pointerleave", function () { touch.active = false; touch.consumed = true; releaseJump(); });
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  document.addEventListener("dblclick", function (e) { e.preventDefault(); });
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  // ---- UI overlays ----------------------------------------------------------
  var ui = { screen: "start", completedLevel: 0, unlockedHat: null };
  var overlaysEl = document.getElementById("overlays");
  var musicBtn = document.getElementById("musicBtn");
  var fartBtn = document.getElementById("fartBtn");
  var _fartState = "";
  // Updates the on-screen FART BOOST button each frame (guarded so DOM writes
  // only happen on a state transition). Hidden unless a run is in progress.
  function updateFartBtn() {
    if (!fartBtn) return;
    var key = st.gameRunning ? (st.boostTimer > 0 ? "a" : (st.boostCooldown === 0 ? "r" : "c")) : "hidden";
    if (key === _fartState) return;
    _fartState = key;
    if (key === "hidden") { fartBtn.style.display = "none"; return; }
    fartBtn.style.display = "flex";
    var active = key === "a", ready = key === "r";
    fartBtn.style.borderColor = active ? "#7CFC00" : ready ? "#3dff5e" : "#333";
    fartBtn.style.boxShadow = active ? "0 0 22px #7CFC00" : ready ? "0 0 16px #3dff5e" : "none";
    fartBtn.style.background = active ? "rgba(124,252,0,0.4)" : ready ? "rgba(61,255,94,0.16)" : "rgba(51,51,51,0.25)";
    fartBtn.style.opacity = (active || ready) ? "1" : "0.5";
    var label = active ? "BOOST!" : ready ? "FART" : "\\u00B7\\u00B7\\u00B7";
    fartBtn.innerHTML = '<span style="font-size:1.6rem;line-height:1;">&#128168;</span>' + label;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function setScreen(s) { ui.screen = s; renderOverlays(); }

  function renderOverlays() {
    var s = ui.screen;
    if (s === "playing" || s === "dead") { overlaysEl.innerHTML = ""; return; }

    var html = "";
    if (s === "start") {
      var maxLv = getMaxLevel();
      var unlockedEmojis = HATS.filter(function (h) { return h.unlockLevel <= maxLv && h.id !== "none"; }).map(function (h) { return h.emoji; }).join(" ") || "\\uD83E\\uDD1A";
      html += '<div class="overlay scroll" style="background:rgba(0,0,0,0.5);color:#fff;text-shadow:0 2px 4px rgba(0,0,0,0.7);">';
      html += '<div style="font-size:2.6rem;font-weight:bold;color:#ffd700;text-shadow:0 4px 10px rgba(0,0,0,0.6);margin-bottom:8px;">\\uD83D\\uDC46 FINGER RUNNER</div>';
      html += '<p style="font-size:0.95rem;margin:10px auto 6px;max-width:520px;line-height:1.5;color:#ffe9a8;font-style:italic;">' + esc(STORY_INTRO) + '</p>';
      html += '<p style="font-size:1.05rem;margin:4px 0;">Swipe \\u2191 jump \\u2022 \\u2193 slide \\u2022 \\u2190 \\u2192 switch lanes \\u2022 tap to jump \\u2022 Clear 8 levels</p>';
      html += '<p style="font-size:1rem;margin:4px 0;color:#aef;">' + unlockedEmojis + ' outfits unlocked \\u2022 reach new levels to earn more!</p>';
      html += '<div style="display:flex;gap:14px;margin-top:24px;flex-wrap:wrap;justify-content:center;">';
      html += '<button class="pressable" data-act="start1" style="padding:16px 38px;font-size:1.35rem;background:#ff4757;color:#fff;border:none;border-radius:60px;box-shadow:0 8px 0 #c2363e;font-weight:bold;">START RUNNING</button>';
      html += '<button class="pressable" data-act="character" style="padding:16px 26px;font-size:1.25rem;background:#3dff5e;color:#083;border:none;border-radius:60px;box-shadow:0 8px 0 #1a9c34;font-weight:bold;">\\uD83C\\uDFC3 RUNNER</button>';
      html += '<button class="pressable" data-act="wardrobe" style="padding:16px 26px;font-size:1.25rem;background:#7c4dff;color:#fff;border:none;border-radius:60px;box-shadow:0 8px 0 #5a2fd0;font-weight:bold;">\\uD83D\\uDC55 WARDROBE</button>';
      html += '</div>';
      html += '<div style="margin-top:22px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:480px;">';
      for (var i = 0; i < LEVELS.length; i++) {
        var lv = LEVELS[i];
        var unlocked = lv.num <= maxLv;
        var label = unlocked ? (lv.num + ". " + lv.name) : ("\\uD83D\\uDD12 Lv " + lv.num);
        html += '<button class="pressable" ' + (unlocked ? 'data-act="startlv" data-lv="' + lv.num + '"' : "") + ' style="padding:8px 14px;font-size:0.9rem;font-weight:bold;background:' + (unlocked ? "#1a73e8" : "rgba(255,255,255,0.15)") + ';color:' + (unlocked ? "#fff" : "#888") + ';border:2px solid ' + (unlocked ? "#4a9eff" : "#555") + ';border-radius:20px;">' + esc(label) + '</button>';
      }
      html += '</div></div>';
    } else if (s === "wardrobe") {
      var maxLv2 = getMaxLevel();
      var equipped = getEquippedHat();
      var myCoins = getTotalCoins();
      var highestOwned = getHighestOwnedSaber();
      var equippedSaber = getEquippedSaber();
      html += '<div class="overlay scroll" style="background:rgba(10,10,30,0.92);color:#fff;">';
      html += '<div style="background:rgba(255,255,255,0.07);border-radius:24px;padding:28px 28px;max-width:540px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.6);">';
      html += '<h2 style="font-size:1.8rem;margin:0 0 6px 0;color:#ffd700;text-align:center;">\\uD83D\\uDC55 WARDROBE</h2>';
      html += '<div style="text-align:center;margin:0 0 20px 0;font-size:1rem;color:#ffd700;">\\uD83E\\uDE99 ' + myCoins + ' coins</div>';
      html += '<h3 style="font-size:1rem;color:#aaa;margin:0 0 10px 0;letter-spacing:0.08em;">HATS &mdash; unlock by reaching new levels</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
      for (var j = 0; j < HATS.length; j++) {
        var hat = HATS[j];
        var hUnlocked = hat.unlockLevel <= maxLv2;
        var hEquipped = equipped === hat.id;
        html += '<div style="background:' + (hEquipped ? "rgba(124,77,255,0.3)" : "rgba(255,255,255,0.06)") + ';border:2px solid ' + (hEquipped ? "#7c4dff" : hUnlocked ? "#555" : "#333") + ';border-radius:14px;padding:14px 14px;display:flex;align-items:center;gap:10px;opacity:' + (hUnlocked ? 1 : 0.5) + ';">';
        html += '<span style="font-size:1.8rem;">' + hat.emoji + '</span>';
        html += '<div style="flex:1;min-width:0;"><div style="font-weight:bold;font-size:0.95rem;">' + esc(hat.name) + '</div>';
        html += '<div style="font-size:0.75rem;color:#aaa;">' + (hat.unlockLevel === 0 ? "Always available" : ("Unlock: Level " + hat.unlockLevel)) + '</div></div>';
        if (hUnlocked) {
          html += '<button class="pressable" data-act="equip" data-hat="' + hat.id + '" style="padding:6px 12px;font-size:0.8rem;font-weight:bold;background:' + (hEquipped ? "#7c4dff" : "#333") + ';color:#fff;border:none;border-radius:20px;">' + (hEquipped ? "\\u2713 ON" : "EQUIP") + '</button>';
        } else {
          html += '<span style="font-size:0.75rem;color:#666;">\\uD83D\\uDD12 Lv ' + hat.unlockLevel + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';
      html += '<h3 style="font-size:1rem;color:#aaa;margin:24px 0 10px 0;letter-spacing:0.08em;">SABERS &mdash; unlock with coins</h3>';
      html += '<div style="display:flex;flex-direction:column;gap:10px;">';
      for (var si = 0; si < SABERS.length; si++) {
        var sb = SABERS[si];
        var sbOwned = sb.tier <= highestOwned;
        var sbEquipped = sb.tier === equippedSaber;
        var sbNextToBuy = sb.tier === highestOwned + 1;
        var canAfford = myCoins >= sb.cost;
        html += '<div style="background:' + (sbEquipped ? "rgba(124,77,255,0.3)" : sbOwned ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)") + ';border:2px solid ' + (sbEquipped ? sb.color : sbOwned ? "#555" : "#333") + ';border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:12px;opacity:' + (sbOwned || sbNextToBuy ? 1 : 0.45) + ';">';
        html += '<span style="font-size:1.8rem;">' + sb.emoji + '</span>';
        html += '<div style="flex:1;min-width:0;"><div style="font-weight:bold;font-size:0.95rem;color:' + sb.color + ';">' + esc(sb.name) + '</div>';
        html += '<div style="font-size:0.75rem;color:#aaa;">Reach ' + sb.reach + 'px' + (sb.cost > 0 ? " &bull; " + sb.cost + " coins" : " &bull; Free") + '</div></div>';
        if (sbOwned) {
          html += '<button class="pressable" data-act="equipsaber" data-tier="' + sb.tier + '" style="padding:6px 12px;font-size:0.8rem;font-weight:bold;background:' + (sbEquipped ? sb.color : "#333") + ';color:#fff;border:none;border-radius:20px;">' + (sbEquipped ? "\\u2713 ON" : "EQUIP") + '</button>';
        } else if (sbNextToBuy) {
          if (canAfford) {
            html += '<button class="pressable" data-act="unlocksaber" data-tier="' + sb.tier + '" style="padding:6px 10px;font-size:0.75rem;font-weight:bold;background:#ffd700;color:#111;border:none;border-radius:20px;">UNLOCK</button>';
          } else {
            var coinsShort = sb.cost - myCoins;
            var runsEst = Math.ceil(coinsShort / 20);
            html += '<div style="text-align:right;line-height:1.4;">';
            html += '<div style="font-size:0.75rem;color:#f90;font-weight:bold;">Need ' + coinsShort + ' more</div>';
            html += '<div style="font-size:0.68rem;color:#888;">~' + runsEst + ' run' + (runsEst !== 1 ? 's' : '') + ' away</div>';
            html += '</div>';
          }
        } else {
          html += '<span style="font-size:0.75rem;color:#666;">\\uD83D\\uDD12</span>';
        }
        html += '</div>';
      }
      html += '</div>';
      html += '<button class="pressable" data-act="menu" style="margin-top:20px;width:100%;padding:14px;font-size:1.05rem;font-weight:bold;background:#444;color:#fff;border:none;border-radius:40px;">\\u2190 Back</button>';
      html += '</div></div>';
    } else if (s === "character") {
      var selChar = getSelectedCharacter();
      html += '<div class="overlay scroll" style="background:rgba(8,14,26,0.94);color:#fff;">';
      html += '<div style="max-width:540px;width:92%;">';
      html += '<h2 style="font-size:1.8rem;margin:0 0 4px 0;color:#3dff5e;text-align:center;">\\uD83C\\uDFC3 CHOOSE YOUR RUNNER</h2>';
      html += '<p style="text-align:center;color:#9fb;font-size:0.9rem;margin:0 0 20px 0;">Each runner brings their own saber color.</p>';
      html += '<div style="display:flex;flex-direction:column;gap:12px;">';
      for (var chi = 0; chi < CHARACTERS.length; chi++) {
        var ch = CHARACTERS[chi];
        var chSel = ch.id === selChar;
        html += '<button class="pressable" data-act="pickchar" data-char="' + ch.id + '" style="display:flex;align-items:center;gap:14px;text-align:left;padding:14px 16px;background:' + (chSel ? "rgba(61,255,94,0.18)" : "rgba(255,255,255,0.06)") + ';border:2px solid ' + (chSel ? "#3dff5e" : "#555") + ';border-radius:16px;color:#fff;cursor:pointer;">';
        html += '<span style="font-size:2.2rem;">' + ch.emoji + '</span>';
        html += '<div style="flex:1;min-width:0;"><div style="font-weight:bold;font-size:1.1rem;">' + esc(ch.name) + '</div>';
        html += '<div style="font-size:0.78rem;color:#aaa;">' + esc(ch.ageLabel) + '</div>';
        html += '<div style="font-size:0.82rem;font-style:italic;margin-top:2px;color:' + ch.saberColor + ';">\\u201C' + esc(ch.tagline) + '\\u201D</div></div>';
        html += '<span style="width:20px;height:20px;border-radius:50%;background:' + ch.saberColor + ';box-shadow:0 0 10px ' + ch.saberColor + ';"></span>';
        html += chSel ? '<span style="color:#3dff5e;font-weight:bold;font-size:0.85rem;">\\u2713</span>' : '';
        html += '</button>';
      }
      html += '</div>';
      html += '<div style="display:flex;gap:12px;margin-top:22px;">';
      html += '<button class="pressable" data-act="start1" style="flex:1;padding:16px;font-size:1.15rem;font-weight:bold;background:#00c853;color:#fff;border:none;border-radius:40px;box-shadow:0 6px 0 #009624;">START RUNNING</button>';
      html += '<button class="pressable" data-act="menu" style="padding:16px 22px;font-size:1.05rem;font-weight:bold;background:#444;color:#fff;border:none;border-radius:40px;">\\u2190 Back</button>';
      html += '</div></div></div>';
    } else if (s === "levelComplete") {
      var cl = ui.completedLevel;
      var story = cl < LEVELS.length ? (LEVEL_STORY[cl + 1] || "The road rolls on\\u2026") : "Lefty & Middy made it home \\u2014 knuckles weary, nails chipped, hearts full.";
      html += '<div class="overlay scroll" style="background:rgba(0,0,0,0.7);">';
      html += '<div style="background:linear-gradient(135deg,#1a1a3a,#2a2a5a);border-radius:24px;padding:30px 30px;max-width:480px;width:92%;text-align:center;box-shadow:0 12px 60px rgba(0,0,0,0.8);border:2px solid rgba(255,215,0,0.3);">';
      html += '<div style="font-size:3rem;margin-bottom:8px;">\\uD83C\\uDF89</div>';
      html += '<h2 style="font-size:2rem;color:#ffd700;margin:0 0 6px 0;">LEVEL COMPLETE!</h2>';
      html += '<p style="font-size:1.15rem;color:#adf;margin:0 0 10px 0;">' + esc(getLevelDef(cl).name) + '</p>';
      html += '<p style="font-size:0.95rem;color:#ffe9a8;font-style:italic;margin:0 0 16px 0;line-height:1.4;">' + esc(story) + '</p>';
      html += '<div style="background:rgba(255,255,255,0.08);border-radius:12px;padding:12px 20px;margin-bottom:18px;">';
      html += '<div style="font-size:0.95rem;color:#aaa;">Distance covered</div>';
      html += '<div style="font-size:1.9rem;font-weight:bold;color:#fff;">' + Math.floor(st.levelScore) + ' m</div></div>';
      if (ui.unlockedHat) {
        html += '<div style="background:rgba(124,77,255,0.25);border:2px solid #7c4dff;border-radius:12px;padding:12px 20px;margin-bottom:18px;">';
        html += '<div style="font-size:0.85rem;color:#c5a9ff;">NEW UNLOCK!</div>';
        html += '<div style="font-size:1.9rem;">' + ui.unlockedHat.emoji + '</div>';
        html += '<div style="font-size:1.05rem;font-weight:bold;color:#fff;">' + esc(ui.unlockedHat.name) + '</div>';
        html += '<button class="pressable" data-act="equip" data-hat="' + ui.unlockedHat.id + '" style="margin-top:8px;padding:6px 20px;font-size:0.85rem;background:#7c4dff;color:#fff;border:none;border-radius:20px;">Equip it!</button>';
        html += '</div>';
      }
      html += '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">';
      if (cl < LEVELS.length) {
        html += '<button class="pressable" data-act="startlv" data-lv="' + (cl + 1) + '" style="padding:16px 32px;font-size:1.2rem;font-weight:bold;background:#00c853;color:#fff;border:none;border-radius:50px;box-shadow:0 6px 0 #009624;">Level ' + (cl + 1) + ' \\u2192</button>';
      } else {
        html += '<button class="pressable" data-act="startlv" data-lv="' + (cl + 1) + '" style="padding:16px 32px;font-size:1.2rem;font-weight:bold;background:#ffd700;color:#222;border:none;border-radius:50px;box-shadow:0 6px 0 #b8960a;">\\uD83C\\uDFC6 Keep Going!</button>';
      }
      html += '<button class="pressable" data-act="menu" style="padding:16px 22px;font-size:1.05rem;background:#333;color:#fff;border:none;border-radius:50px;">Menu</button>';
      html += '</div></div></div>';
    }

    overlaysEl.innerHTML = html;
    bindOverlayActions();
  }

  function bindOverlayActions() {
    var btns = overlaysEl.querySelectorAll("[data-act]");
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var act = btn.getAttribute("data-act");
          if (act === "start1") startLevel(1);
          else if (act === "wardrobe") setScreen("wardrobe");
          else if (act === "character") setScreen("character");
          else if (act === "pickchar") { var pc = btn.getAttribute("data-char"); setSelectedCharacter(pc); initAudio(); playCharacterVoice(pc); renderOverlays(); }
          else if (act === "menu") goToMenu();
          else if (act === "startlv") startLevel(parseInt(btn.getAttribute("data-lv"), 10));
          else if (act === "equip") { setEquippedHat(btn.getAttribute("data-hat")); renderOverlays(); }
          else if (act === "equipsaber") { setEquippedSaber(parseInt(btn.getAttribute("data-tier"), 10)); renderOverlays(); }
          else if (act === "unlocksaber") {
            var buyTier = parseInt(btn.getAttribute("data-tier"), 10);
            var buyCost = getSaberDef(buyTier).cost;
            var curCoins = getTotalCoins();
            if (buyTier === getHighestOwnedSaber() + 1 && curCoins >= buyCost) {
              setTotalCoins(curCoins - buyCost);
              setHighestOwnedSaber(buyTier);
              setEquippedSaber(buyTier);
            }
            renderOverlays();
          }
        });
      })(btns[i]);
    }
  }

  function goToMenu() {
    stopMusic();
    if (audio.enabled) startMusic("start", false);
    setScreen("start");
  }

  // ---- FART BOOST -----------------------------------------------------------
  // 2.5s world-speed boost with a green gas trail and a cooldown. Mirrors web
  // Game.tsx fartBoost(). Only fires mid-run when off cooldown.
  function fartBoost() {
    if (!st.gameRunning) return;
    if (st.boostTimer > 0 || st.boostCooldown > 0) return;
    initAudio();
    st.boostTimer = BOOST_FRAMES;
    st.boostCooldown = BOOST_COOLDOWN;
    playFart();
  }

  // ---- Music toggle ---------------------------------------------------------
  function updateMusicBtn() { musicBtn.innerHTML = "\\uD83C\\uDFB5 " + (audio.enabled ? "ON" : "OFF"); }
  musicBtn.addEventListener("click", function () {
    audio.enabled = !audio.enabled;
    updateMusicBtn();
    if (audio.enabled) {
      var lvlDef = getLevelDef(st.currentLevel);
      var themeId = st.gameRunning ? lvlDef.theme : ((ui.screen === "start" || ui.screen === "wardrobe") ? "start" : lvlDef.theme);
      startMusic(themeId, st.gameRunning, lvlDef.speedMult);
    } else stopMusic();
  });

  fartBtn.addEventListener("click", function () { fartBoost(); });

  // ---- Boot -----------------------------------------------------------------
  updateMusicBtn();
  setScreen("start");
  requestAnimationFrame(loop);
  setTimeout(function () { if (audio.enabled) startMusic("start", false); }, 650);
})();
</script>
</body>
</html>`;
