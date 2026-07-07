// Self-contained vanilla-JS port of the Finger Runner web game (artifacts/finger-runner/src/Game.tsx).
// Rendered inside a react-native-webview. Persistence is bridged to AsyncStorage via postMessage:
//   - reads are seeded from window.__INIT_STORAGE__ (injected before content loads)
//   - writes post { type:'persist', key, value } to the React Native host
// NOTE: intentionally contains NO backticks or ${} so it nests safely in the TS template literal below.

export const STORAGE_KEYS = {
  best: "fingerRunnerBest",
  maxLevel: "fingerRunnerMaxLevel",
  hat: "fingerRunnerHat",
} as const;

export const GAME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; }
  html, body { width:100%; height:100%; overflow:hidden; background:#87CEEB; touch-action:none; overscroll-behavior:none; position:fixed; font-family:Arial, sans-serif; }
  #game { position:relative; width:100vw; height:100vh; overflow:hidden; touch-action:none; background:#87CEEB; }
  canvas { display:block; touch-action:none; }
  #overlays { position:absolute; inset:0; z-index:10; pointer-events:none; }
  .overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; pointer-events:auto; font-family:Arial, sans-serif; padding:16px; }
  .overlay.scroll { justify-content:flex-start; overflow-y:auto; padding-top:24px; padding-bottom:24px; -webkit-overflow-scrolling:touch; }
  button { font-family:Arial, sans-serif; -webkit-appearance:none; appearance:none; }
  .pressable:active { transform:translateY(3px); filter:brightness(0.9); }
  #musicBtn { position:absolute; top:20px; right:20px; z-index:20; padding:10px 18px; font-size:1.05rem; background:rgba(0,0,0,0.6); color:#fff; border:2px solid #ffd700; border-radius:30px; cursor:pointer; pointer-events:auto; }
</style>
</head>
<body>
<div id="game">
  <canvas id="c"></canvas>
  <div id="overlays"></div>
  <button id="musicBtn" class="pressable">&#127925; ON</button>
</div>
<script>
(function () {
  "use strict";

  // ---- Persistence bridge ---------------------------------------------------
  // Native (react-native-webview): seeded from window.__INIT_STORAGE__ and writes
  // are posted to the RN host (AsyncStorage). Web (iframe fallback): uses localStorage.
  var INIT = window.__INIT_STORAGE__ || {};
  var hasRN = !!(window.ReactNativeWebView && window.ReactNativeWebView.postMessage);
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
  var FINGER_TIP_OFFSET = 90;
  var ROAD_SURFACE_OFFSET = 108;

  function getGroundY(h) { return h - ROAD_SURFACE_OFFSET - FINGER_TIP_OFFSET - 8; }

  // ---- Level definitions ----------------------------------------------------
  var LEVELS = [
    { num:1, name:"Neighborhood Cruise", target:500,  theme:"suburb",   speedMult:1.0,  minSpawn:130 },
    { num:2, name:"Shopping District",   target:600,  theme:"suburb",   speedMult:1.25, minSpawn:120 },
    { num:3, name:"Downtown",            target:650,  theme:"city",     speedMult:1.5,  minSpawn:110 },
    { num:4, name:"City Center",         target:700,  theme:"city",     speedMult:1.8,  minSpawn:100 },
    { num:5, name:"Highway On-Ramp",     target:750,  theme:"highway",  speedMult:2.1,  minSpawn:90  },
    { num:6, name:"Open Highway",        target:800,  theme:"highway",  speedMult:2.5,  minSpawn:80  },
    { num:7, name:"Mountain Pass",       target:900,  theme:"mountain", speedMult:3.0,  minSpawn:70  },
    { num:8, name:"Night Drive",         target:1000, theme:"night",    speedMult:3.6,  minSpawn:60  }
  ];
  function getLevelDef(num) { return LEVELS[Math.min(num - 1, LEVELS.length - 1)]; }

  // ---- Hat catalogue --------------------------------------------------------
  var HATS = [
    { id:"none",   name:"Bare Knuckle",  emoji:"\\uD83E\\uDD1A", unlockLevel:0 },
    { id:"tophat", name:"Top Hat",       emoji:"\\uD83C\\uDFA9", unlockLevel:2 },
    { id:"cap",    name:"Baseball Cap",  emoji:"\\uD83E\\uDDE2", unlockLevel:3 },
    { id:"crown",  name:"Gold Crown",    emoji:"\\uD83D\\uDC51", unlockLevel:5 },
    { id:"cowboy", name:"Cowboy Hat",    emoji:"\\uD83E\\uDD20", unlockLevel:6 },
    { id:"viking", name:"Viking Helmet", emoji:"\\u2694\\uFE0F", unlockLevel:8 }
  ];

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
    jumpsUsed: 0,
    jumpHeld: false,
    coyoteTimer: 0,
    jumpBuffer: 0,
    landImpact: 0,
    shake: 0,
    obstacles: [],
    particles: [],
    bloodPuddles: [],
    crashFlash: 0,
    dialog: null,
    dialogCooldown: 200
  };

  var audio = { ctx:null, enabled:true, interval:null, melodyOsc:null, bassOsc:null, kickOsc:null, step:0 };

  // ---- Audio ----------------------------------------------------------------
  function initAudio() {
    if (!audio.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audio.ctx = new AC();
    }
    if (audio.ctx && audio.ctx.state === "suspended") { try { audio.ctx.resume(); } catch (e) {} }
  }
  function stopMusic() {
    if (audio.interval) { clearInterval(audio.interval); audio.interval = null; }
    try { if (audio.melodyOsc) { audio.melodyOsc.stop(); audio.melodyOsc = null; } } catch (e) {}
    try { if (audio.bassOsc) { audio.bassOsc.stop(); audio.bassOsc = null; } } catch (e) {}
    try { if (audio.kickOsc) { audio.kickOsc.stop(); audio.kickOsc = null; } } catch (e) {}
  }
  function startMusic(isPlaying) {
    if (!audio.enabled) return;
    initAudio();
    if (audio.interval) return;
    audio.step = 0;
    audio.interval = setInterval(function () {
      var ctx = audio.ctx; if (!ctx) return;
      var running = st.gameRunning;
      var t = ctx.currentTime;
      var baseNote = 220;
      var melodyNotes = [0, 4, 7, 12, 7, 4, 0, 2, 5, 9, 5, 2];
      var note = baseNote * Math.pow(2, melodyNotes[audio.step % melodyNotes.length] / 12);
      try { if (audio.melodyOsc) audio.melodyOsc.stop(); } catch (e) {}
      audio.melodyOsc = ctx.createOscillator();
      var mGain = ctx.createGain(); var mFilter = ctx.createBiquadFilter();
      audio.melodyOsc.type = "sawtooth"; audio.melodyOsc.frequency.value = note;
      mFilter.type = "lowpass"; mFilter.frequency.value = 1800;
      var vol = running ? 0.18 : 0.09; var envTime = running ? 0.38 : 0.55;
      mGain.gain.value = vol; mGain.gain.setValueAtTime(vol, t); mGain.gain.linearRampToValueAtTime(0.001, t + envTime);
      audio.melodyOsc.connect(mFilter); mFilter.connect(mGain); mGain.connect(ctx.destination);
      audio.melodyOsc.start(t); audio.melodyOsc.stop(t + envTime + 0.05);
      if (audio.step % 2 === 0) {
        try { if (audio.bassOsc) audio.bassOsc.stop(); } catch (e) {}
        audio.bassOsc = ctx.createOscillator(); var bGain = ctx.createGain();
        audio.bassOsc.type = "sine"; audio.bassOsc.frequency.value = baseNote / 2;
        bGain.gain.value = running ? 0.55 : 0.3; bGain.gain.linearRampToValueAtTime(0.001, t + 0.65);
        audio.bassOsc.connect(bGain); bGain.connect(ctx.destination); audio.bassOsc.start(t); audio.bassOsc.stop(t + 0.7);
      }
      if (audio.step % 4 === 0) {
        try { if (audio.kickOsc) audio.kickOsc.stop(); } catch (e) {}
        audio.kickOsc = ctx.createOscillator(); var kGain = ctx.createGain(); var kFilter = ctx.createBiquadFilter();
        audio.kickOsc.type = "sine"; audio.kickOsc.frequency.value = 95;
        kFilter.type = "lowpass"; kFilter.frequency.value = 450;
        kGain.gain.value = 1.1; kGain.gain.linearRampToValueAtTime(0.001, t + 0.45);
        audio.kickOsc.frequency.setValueAtTime(95, t); audio.kickOsc.frequency.linearRampToValueAtTime(42, t + 0.25);
        audio.kickOsc.connect(kFilter); kFilter.connect(kGain); kGain.connect(ctx.destination);
        audio.kickOsc.start(t); audio.kickOsc.stop(t + 0.5);
      }
      audio.step++;
    }, isPlaying ? 185 : 280);
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

  // ---- Obstacles ------------------------------------------------------------
  var OBSTACLE_TYPES = [
    { type:"mailbox",  w:36, h:68 }, { type:"hydrant",  w:34, h:58 },
    { type:"stopsign", w:22, h:88 }, { type:"trashcan", w:36, h:66 },
    { type:"dog",      w:44, h:46 }, { type:"cat",      w:28, h:42 },
    { type:"bicycle",  w:46, h:68 }, { type:"gnome",    w:30, h:62 },
    { type:"cone",     w:32, h:56 }, { type:"newsbox",  w:36, h:60 }
  ];
  function spawnObstacle(width) {
    var p = OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)];
    st.obstacles.push({ x: width + 80, obsWidth: p.w, obsHeight: p.h, type: p.type, passed: false });
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
      st.particles.push({
        x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2.5 - Math.random() * 3,
        life: 55 + Math.random() * 35, size: 4 + Math.random() * 9,
        color: bloodColors[Math.floor(Math.random() * bloodColors.length)], shape: "circle"
      });
    }
    for (i = 0; i < 12; i++) {
      angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      speed = 4 + Math.random() * 7;
      st.particles.push({
        x: x, y: y - 10 + Math.random() * 20,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 3,
        life: 45 + Math.random() * 25, size: 5 + Math.random() * 7,
        color: boneColors[Math.floor(Math.random() * boneColors.length)],
        shape: "bone", rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.4
      });
    }
    for (i = 0; i < 10; i++) {
      angle = Math.random() * Math.PI * 2; speed = 2 + Math.random() * 5;
      st.particles.push({ x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
        life: 35 + Math.random() * 20, size: 8 + Math.random() * 10,
        color: skinColors[Math.floor(Math.random() * 3)], shape: "rect" });
    }
    st.bloodPuddles.push({ x: x + (Math.random() - 0.5) * 60, y: roadY - 4,
      rx: 28 + Math.random() * 28, ry: 8 + Math.random() * 8, life: 420, maxLife: 420 });
    for (var k = 0; k < 3; k++) {
      st.bloodPuddles.push({ x: x + (Math.random() - 0.5) * 120, y: roadY - 3,
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
    stopMusic();
    setTimeout(function () { if (!st.gameRunning && audio.enabled) startMusic(false); }, 600);
    setScreen("dead");
  }

  function levelCompleteEvent() {
    if (!st.gameRunning || st.levelComplete) return;
    st.gameRunning = false;
    st.levelComplete = true;
    playLevelUpSound();
    stopMusic();
    var lvl = st.currentLevel;
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
      st.particles.push({
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

  function startLevel(levelNum) {
    initAudio();
    var groundY = getGroundY(VH);
    st.gameRunning = true;
    st.levelComplete = false;
    st.currentLevel = levelNum;
    st.levelScore = 0;
    st.obstacles = [];
    st.particles = [];
    st.bloodPuddles = [];
    st.crashFlash = 0;
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
    st.dialog = { text: LEVEL_STORY[levelNum] || pick(RUN_QUIPS), life: 200, maxLife: 200 };
    st.dialogCooldown = 320;
    setScreen("playing");
    stopMusic();
    if (audio.enabled) setTimeout(function () { startMusic(true); }, 80);
  }

  // ---- Background themes ----------------------------------------------------
  function drawCloud(ctx, x, y, scale) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.arc(20, 4, 22, 0, Math.PI * 2);
    ctx.arc(44, 2, 16, 0, Math.PI * 2);
    ctx.arc(22, -12, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBackground(ctx, width, height, time, theme) {
    var grad = ctx.createLinearGradient(0, 0, 0, height);
    if (theme === "suburb") {
      grad.addColorStop(0, "#5db8f0"); grad.addColorStop(0.45, "#8ed0ff"); grad.addColorStop(1, "#c8e8ff");
    } else if (theme === "city") {
      grad.addColorStop(0, "#7a9bbf"); grad.addColorStop(0.5, "#a0b8cc"); grad.addColorStop(1, "#c4d4df");
    } else if (theme === "highway") {
      grad.addColorStop(0, "#3a90d8"); grad.addColorStop(0.4, "#6ab8f0"); grad.addColorStop(1, "#b8dcf4");
    } else if (theme === "mountain") {
      grad.addColorStop(0, "#6ab5e8"); grad.addColorStop(0.4, "#9ad0f0"); grad.addColorStop(1, "#d0eaf8");
    } else {
      grad.addColorStop(0, "#0a0a22"); grad.addColorStop(0.5, "#1a1a40"); grad.addColorStop(1, "#2a2a55");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    if (theme !== "night") {
      var span = width + 260;
      for (var c = 0; c < 5; c++) {
        var scale = 0.7 + (c % 3) * 0.45;
        var cx2 = ((c * 360 - time * (0.25 + scale * 0.18)) % span + span) % span - 130;
        var cy2 = 48 + (c % 3) * 52 + (c % 2) * 14;
        drawCloud(ctx, cx2, cy2, scale);
      }
    }

    if (theme === "night") {
      ctx.fillStyle = "#fff";
      for (var s = 0; s < 80; s++) {
        var sx = ((s * 173 + time * 0.2) % width + width) % width;
        var sy = (s * 137) % (height * 0.55);
        var ss = s % 3 === 0 ? 2 : 1;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 0.02 + s);
        ctx.fillRect(sx, sy, ss, ss);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,140,0,0.12)";
      ctx.beginPath(); ctx.ellipse(width * 0.3, height * 0.65, 200, 60, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,160,30,0.08)";
      ctx.beginPath(); ctx.ellipse(width * 0.72, height * 0.68, 150, 45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111128";
      var buildings = [0.05,0.12,0.18,0.24,0.32,0.38,0.44,0.52,0.58,0.64,0.70,0.78,0.85,0.92];
      var bHeights = [90,140,80,120,100,160,70,130,90,150,110,80,140,100];
      var bWidths  = [40,30,50,35,45,25,55,38,42,28,48,52,32,44];
      buildings.forEach(function (bx, i) {
        var bh = bHeights[i]; var bw = bWidths[i];
        ctx.fillRect(bx * width, height - 108 - bh, bw, bh);
        ctx.fillStyle = "rgba(255,220,80,0.6)";
        for (var wx = 4; wx < bw - 4; wx += 10) {
          for (var wy = 8; wy < bh - 10; wy += 14) {
            if (Math.random() > 0.3) ctx.fillRect(bx * width + wx, height - 108 - bh + wy, 6, 8);
          }
        }
        ctx.fillStyle = "#111128";
      });
    } else if (theme === "city") {
      ctx.fillStyle = "#5a6878";
      var cfgs = [[0.02,50,55],[0.1,80,38],[0.17,45,60],[0.25,100,30],[0.33,65,48],[0.42,55,40],[0.5,90,35],[0.58,70,45],[0.65,48,55],[0.72,85,32],[0.8,60,50],[0.88,45,62],[0.94,75,38]];
      cfgs.forEach(function (a) { ctx.fillRect(a[0] * width, height - 108 - a[1], a[2], a[1]); });
      ctx.fillStyle = "#6a7888";
      var cfgs2 = [[0.06,35,40],[0.15,60,28],[0.22,30,48],[0.3,75,25],[0.4,40,32],[0.48,65,28],[0.56,50,36],[0.63,35,44],[0.7,65,26],[0.78,45,38],[0.86,30,50]];
      cfgs2.forEach(function (a) { ctx.fillRect(a[0] * width, height - 108 - a[1], a[2], a[1]); });
    } else if (theme === "mountain") {
      ctx.fillStyle = "#4a6858";
      ctx.beginPath();
      ctx.moveTo(0, height * 0.75);
      ctx.lineTo(width * 0.12, height * 0.42); ctx.lineTo(width * 0.25, height * 0.65);
      ctx.lineTo(width * 0.38, height * 0.35); ctx.lineTo(width * 0.52, height * 0.58);
      ctx.lineTo(width * 0.65, height * 0.30); ctx.lineTo(width * 0.78, height * 0.52);
      ctx.lineTo(width * 0.90, height * 0.38); ctx.lineTo(width, height * 0.55);
      ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#e8f0f8";
      [[0.38, height * 0.35],[0.65, height * 0.30],[0.90, height * 0.38]].forEach(function (m) {
        var mx = m[0], my = m[1];
        ctx.beginPath();
        ctx.moveTo(mx * width, my); ctx.lineTo(mx * width - 18, my + 28); ctx.lineTo(mx * width + 18, my + 28);
        ctx.closePath(); ctx.fill();
      });
      ctx.fillStyle = "#2d4a38";
      [0.05,0.09,0.15,0.20,0.45,0.48,0.55,0.60,0.75,0.80,0.87,0.92].forEach(function (tx) {
        ctx.beginPath();
        ctx.moveTo(tx * width, height - 108 - 55);
        ctx.lineTo(tx * width - 14, height - 108); ctx.lineTo(tx * width + 14, height - 108);
        ctx.closePath(); ctx.fill();
      });
    } else if (theme === "highway") {
      ctx.fillStyle = "#5a8a6a";
      ctx.beginPath();
      ctx.moveTo(0, height * 0.85);
      ctx.lineTo(width * 0.5, height * 0.70); ctx.lineTo(width, height * 0.82);
      ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#7aac8a";
      ctx.beginPath();
      ctx.moveTo(0, height * 0.78);
      ctx.quadraticCurveTo(width * 0.3, height * 0.62, width * 0.6, height * 0.75);
      ctx.quadraticCurveTo(width * 0.85, height * 0.55, width, height * 0.72);
      ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = "#7aa8c2";
      ctx.beginPath();
      ctx.moveTo(0, height * 0.72);
      ctx.quadraticCurveTo(width * 0.25, height * 0.48, width * 0.55, height * 0.76);
      ctx.quadraticCurveTo(width * 0.82, height * 0.42, width, height * 0.69);
      ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.fill();
      ctx.fillStyle = "#5d8a9e";
      ctx.beginPath();
      ctx.moveTo(0, height * 0.78);
      ctx.quadraticCurveTo(width * 0.35, height * 0.58, width * 0.7, height * 0.81);
      ctx.quadraticCurveTo(width * 0.92, height * 0.62, width, height * 0.77);
      ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.fill();
    }

    if (theme === "city") { ctx.fillStyle = "#8a8a9a"; }
    else if (theme === "highway") { ctx.fillStyle = "#6a7260"; }
    else if (theme === "mountain") { ctx.fillStyle = "#7a7060"; }
    else if (theme === "night") { ctx.fillStyle = "#3a3a4a"; }
    else { ctx.fillStyle = "#7db560"; }
    ctx.fillRect(0, height - 108, width, 18);

    ctx.fillStyle = theme === "night" ? "#1e1e2e" : theme === "highway" ? "#4a5260" : "#555e6a";
    ctx.fillRect(0, height - 90, width, 90);

    ctx.fillStyle = theme === "night" ? "#444" : "#8a929e";
    ctx.fillRect(0, height - 92, width, 5);

    var dashSpeed = theme === "highway" ? 6.0 : 3.8;
    ctx.strokeStyle = theme === "night" ? "rgba(255,200,0,0.5)" : "rgba(255,255,255,0.4)";
    ctx.lineWidth = 4;
    var i2, xPos;
    for (i2 = -1; i2 < 7; i2++) {
      xPos = ((time * dashSpeed) % (width + 180)) + i2 * (width / 5.5) - 90;
      ctx.beginPath(); ctx.moveTo(xPos, height - 50); ctx.lineTo(xPos + 60, height - 50); ctx.stroke();
    }
    if (theme === "highway") {
      ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 3;
      for (i2 = -1; i2 < 7; i2++) {
        xPos = ((time * dashSpeed) % (width + 180)) + i2 * (width / 5.5) - 90;
        ctx.beginPath(); ctx.moveTo(xPos, height - 30); ctx.lineTo(xPos + 60, height - 30); ctx.stroke();
      }
    }
    if (theme === "night") {
      for (var li = 0; li < 6; li++) {
        var lx = ((width * 0.18 * li - time * 2.0) % (width + 100) + width + 100) % (width + 100) - 50;
        ctx.fillStyle = "#555"; ctx.fillRect(lx - 3, height - 108 - 80, 6, 80);
        ctx.fillStyle = "#555"; ctx.fillRect(lx - 3, height - 108 - 80, 28, 5);
        ctx.fillStyle = "rgba(255,200,60,0.9)";
        ctx.beginPath(); ctx.arc(lx + 25, height - 108 - 78, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,200,60,0.08)";
        ctx.beginPath(); ctx.ellipse(lx + 25, height - 108 - 40, 55, 55, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // ---- Obstacle drawings ----------------------------------------------------
  function drawObstacle(ctx, o, height) {
    var roadY = height - ROAD_SURFACE_OFFSET;
    var gx = o.x + o.obsWidth / 2;
    var by = roadY;
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";

    if (o.type === "mailbox") {
      ctx.fillStyle = "#8B5E3C"; ctx.fillRect(gx - 5, by - o.obsHeight, 10, o.obsHeight);
      ctx.fillStyle = "#b0b8c5"; ctx.beginPath(); ctx.roundRect(gx - 20, by - o.obsHeight, 42, 32, 4); ctx.fill();
      ctx.fillStyle = "#c8d0db"; ctx.beginPath(); ctx.ellipse(gx + 1, by - o.obsHeight + 2, 21, 12, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#888"; ctx.fillRect(gx - 14, by - o.obsHeight + 18, 28, 4);
      ctx.fillStyle = "#e53935"; ctx.fillRect(gx + 18, by - o.obsHeight + 5, 4, 18); ctx.fillRect(gx + 18, by - o.obsHeight + 5, 14, 10);
      ctx.fillStyle = "#555"; ctx.font = "bold 9px Arial"; ctx.textAlign = "center"; ctx.fillText("42", gx, by - o.obsHeight + 30);

    } else if (o.type === "hydrant") {
      var hy = by - o.obsHeight;
      ctx.fillStyle = "#c62828"; ctx.beginPath(); ctx.ellipse(gx, by - 6, 22, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e53935"; ctx.beginPath(); ctx.roundRect(gx - 16, hy + 14, 32, o.obsHeight - 20, 6); ctx.fill();
      ctx.fillStyle = "#ff5252"; ctx.beginPath(); ctx.ellipse(gx, hy + 16, 16, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd600"; ctx.beginPath(); ctx.ellipse(gx, hy + 6, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c62828"; ctx.fillRect(gx - 24, by - 38, 10, 12); ctx.fillRect(gx + 14, by - 38, 10, 12);
      ctx.fillStyle = "#ffd600"; ctx.beginPath(); ctx.arc(gx - 19, by - 32, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(gx + 19, by - 32, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.beginPath(); ctx.ellipse(gx - 5, hy + 20, 5, 10, -0.3, 0, Math.PI * 2); ctx.fill();

    } else if (o.type === "stopsign") {
      ctx.fillStyle = "#888"; ctx.fillRect(gx - 4, by - o.obsHeight, 8, o.obsHeight);
      ctx.fillStyle = "#aaa"; ctx.fillRect(gx - 3, by - o.obsHeight, 4, o.obsHeight);
      var sr = 22; var sy = by - o.obsHeight + sr + 4;
      ctx.fillStyle = "#cc0000"; ctx.beginPath();
      for (var i = 0; i < 8; i++) { var a = (i * Math.PI) / 4 - Math.PI / 8; var px = gx + sr * Math.cos(a); var py = sy + sr * Math.sin(a); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px Arial"; ctx.textAlign = "center"; ctx.fillText("STOP", gx, sy + 4);

    } else if (o.type === "trashcan") {
      var tw = 40; var th = o.obsHeight;
      ctx.fillStyle = "#78909c";
      ctx.beginPath(); ctx.moveTo(gx - tw / 2 + 4, by - th + 14); ctx.lineTo(gx + tw / 2 - 4, by - th + 14); ctx.lineTo(gx + tw / 2 + 2, by); ctx.lineTo(gx - tw / 2 - 2, by); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#546e7a"; ctx.beginPath(); ctx.roundRect(gx - tw / 2 - 4, by - th + 4, tw + 8, 14, 4); ctx.fill();
      ctx.fillStyle = "#78909c"; ctx.fillRect(gx - 8, by - th, 16, 6);
      ctx.strokeStyle = "#546e7a"; ctx.lineWidth = 2;
      for (var r = 1; r <= 3; r++) { var ry = by - th + 14 + r * ((th - 14) / 4); ctx.beginPath(); ctx.moveTo(gx - tw / 2 + 2, ry); ctx.lineTo(gx + tw / 2 - 2, ry); ctx.stroke(); }
      ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(gx - tw / 2 + 6, by - th + 18, 8, th - 20);

    } else if (o.type === "dog") {
      var dy = by - o.obsHeight;
      ctx.fillStyle = "#c4954a"; ctx.beginPath(); ctx.ellipse(gx - 5, dy + 22, 32, 18, 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#d4a55a"; ctx.beginPath(); ctx.ellipse(gx + 28, dy + 14, 18, 16, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#b07030"; ctx.beginPath(); ctx.ellipse(gx + 34, dy + 18, 8, 14, 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c4954a"; ctx.beginPath(); ctx.ellipse(gx + 44, dy + 20, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#333"; ctx.beginPath(); ctx.ellipse(gx + 53, dy + 17, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(gx + 36, dy + 10, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(gx + 37, dy + 9, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#b07030"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(gx - 36, dy + 12, 14, 0.2, Math.PI * 1.4); ctx.stroke();
      ctx.fillStyle = "#b07030";
      [gx - 18, gx - 5, gx + 8, gx + 20].forEach(function (lx) { ctx.fillRect(lx - 4, dy + 34, 8, 16); });
      ctx.fillStyle = "#c4954a";
      [gx - 18, gx - 5, gx + 8, gx + 20].forEach(function (lx) { ctx.beginPath(); ctx.ellipse(lx, dy + 50, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); });

    } else if (o.type === "cat") {
      var cy2 = by - o.obsHeight;
      ctx.fillStyle = "#888"; ctx.beginPath(); ctx.ellipse(gx, cy2 + 22, 16, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#999"; ctx.beginPath(); ctx.arc(gx, cy2 + 6, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#999";
      ctx.beginPath(); ctx.moveTo(gx - 10, cy2); ctx.lineTo(gx - 16, cy2 - 12); ctx.lineTo(gx - 2, cy2 - 4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(gx + 10, cy2); ctx.lineTo(gx + 16, cy2 - 12); ctx.lineTo(gx + 2, cy2 - 4); ctx.fill();
      ctx.fillStyle = "#f48fb1";
      ctx.beginPath(); ctx.moveTo(gx - 9, cy2 - 1); ctx.lineTo(gx - 13, cy2 - 9); ctx.lineTo(gx - 3, cy2 - 4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(gx + 9, cy2 - 1); ctx.lineTo(gx + 13, cy2 - 9); ctx.lineTo(gx + 3, cy2 - 4); ctx.fill();
      ctx.fillStyle = "#4caf50";
      ctx.beginPath(); ctx.ellipse(gx - 5, cy2 + 5, 4, 3, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(gx + 5, cy2 + 5, 4, 3, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.ellipse(gx - 5, cy2 + 5, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(gx + 5, cy2 + 5, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f48fb1"; ctx.beginPath(); ctx.arc(gx, cy2 + 10, 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#bbb"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx - 3, cy2 + 10); ctx.lineTo(gx - 14, cy2 + 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx + 3, cy2 + 10); ctx.lineTo(gx + 14, cy2 + 9); ctx.stroke();
      ctx.strokeStyle = "#888"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(gx + 14, cy2 + 28); ctx.quadraticCurveTo(gx + 30, cy2 + 36, gx + 22, cy2 + 44); ctx.stroke();

    } else if (o.type === "bicycle") {
      var bby = by - 12; var wr = 30; var blx = o.x + wr + 4; var brx = o.x + o.obsWidth - wr - 4; var axleY = bby - wr;
      [blx, brx].forEach(function (wx) {
        ctx.strokeStyle = "#222"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(wx, axleY, wr, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "#999"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(wx, axleY, wr - 4, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "#aaa"; ctx.lineWidth = 1.5;
        for (var sp = 0; sp < 6; sp++) { var a = (sp * Math.PI) / 3; ctx.beginPath(); ctx.moveTo(wx, axleY); ctx.lineTo(wx + (wr - 5) * Math.cos(a), axleY + (wr - 5) * Math.sin(a)); ctx.stroke(); }
        ctx.fillStyle = "#888"; ctx.beginPath(); ctx.arc(wx, axleY, 5, 0, Math.PI * 2); ctx.fill();
      });
      ctx.strokeStyle = "#e53935"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(blx, axleY); ctx.lineTo(gx - 2, axleY - wr + 6); ctx.lineTo(brx, axleY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx - 2, axleY - wr + 6); ctx.lineTo(brx, axleY); ctx.stroke();
      ctx.strokeStyle = "#888"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(brx, axleY); ctx.lineTo(brx - 2, axleY - 18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(brx - 8, axleY - 18); ctx.lineTo(brx + 8, axleY - 18); ctx.stroke();
      ctx.fillStyle = "#333"; ctx.beginPath(); ctx.roundRect(gx - 18, axleY - wr + 2, 32, 8, 4); ctx.fill();

    } else if (o.type === "gnome") {
      var gy = by - o.obsHeight;
      ctx.fillStyle = "#1565c0"; ctx.fillRect(gx - 12, gy + 42, 9, 24); ctx.fillRect(gx + 3, gy + 42, 9, 24);
      ctx.fillStyle = "#4e342e"; ctx.beginPath(); ctx.ellipse(gx - 8, by - 4, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(gx + 8, by - 4, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c62828";
      ctx.beginPath(); ctx.moveTo(gx - 16, gy + 44); ctx.quadraticCurveTo(gx - 18, gy + 22, gx, gy + 18); ctx.quadraticCurveTo(gx + 18, gy + 22, gx + 16, gy + 44); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#4e342e"; ctx.fillRect(gx - 14, gy + 38, 28, 6);
      ctx.fillStyle = "#ffd600"; ctx.beginPath(); ctx.roundRect(gx - 5, gy + 37, 10, 8, 2); ctx.fill();
      ctx.fillStyle = "#ffcc80"; ctx.beginPath(); ctx.arc(gx, gy + 14, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.moveTo(gx - 10, gy + 18); ctx.quadraticCurveTo(gx, gy + 28, gx + 10, gy + 18); ctx.quadraticCurveTo(gx, gy + 34, gx - 10, gy + 18); ctx.fill();
      ctx.fillStyle = "#333"; ctx.beginPath(); ctx.arc(gx - 4, gy + 12, 2, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(gx + 4, gy + 12, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c62828"; ctx.beginPath(); ctx.moveTo(gx, gy - 4); ctx.lineTo(gx - 13, gy + 4); ctx.lineTo(gx + 13, gy + 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(gx, gy + 4, 15, 5, 0, 0, Math.PI * 2); ctx.fill();

    } else if (o.type === "cone") {
      ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.beginPath(); ctx.ellipse(gx, by - 3, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f57c00"; ctx.beginPath(); ctx.moveTo(gx, by - o.obsHeight); ctx.lineTo(gx - 22, by - 5); ctx.lineTo(gx + 22, by - 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff";
      for (var sc = 0; sc < 2; sc++) { var sy2 = by - o.obsHeight + (o.obsHeight * 0.4) + sc * (o.obsHeight * 0.22); var sw = 5 + sc * 10; ctx.beginPath(); ctx.moveTo(gx - sw, sy2); ctx.lineTo(gx + sw, sy2); ctx.lineTo(gx + sw + 4, sy2 + 10); ctx.lineTo(gx - sw - 4, sy2 + 10); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = "#e65100"; ctx.beginPath(); ctx.roundRect(gx - 24, by - 8, 48, 8, 2); ctx.fill();

    } else if (o.type === "newsbox") {
      var nw = 46; var nh = o.obsHeight;
      ctx.fillStyle = "#555"; ctx.fillRect(gx - 14, by - 20, 6, 20); ctx.fillRect(gx + 8, by - 20, 6, 20);
      ctx.fillStyle = "#1976d2"; ctx.beginPath(); ctx.roundRect(gx - nw / 2, by - nh, nw, nh - 14, 5); ctx.fill();
      ctx.fillStyle = "#bbdefb"; ctx.beginPath(); ctx.roundRect(gx - nw / 2 + 4, by - nh + 4, nw - 8, nh - 28, 3); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(gx - nw / 2 + 6, by - nh + 7, nw - 12, nh - 34, 2); ctx.fill();
      ctx.fillStyle = "#333"; ctx.font = "bold 8px Arial"; ctx.textAlign = "center"; ctx.fillText("NEWS", gx, by - nh + 16);
      ctx.fillStyle = "#666"; ctx.font = "6px Arial"; ctx.fillText("DAILY", gx, by - nh + 24);
      ctx.fillStyle = "#0d47a1"; ctx.fillRect(gx - nw / 2 + 6, by - nh + nh - 22, nw - 12, 6);
      ctx.fillStyle = "#1565c0"; ctx.fillRect(gx - 4, by - nh + nh - 22, 8, 6);
    }
    ctx.restore();
  }

  // ---- Hat drawing ----------------------------------------------------------
  function drawHat(ctx, hatId) {
    if (hatId === "none") return;
    ctx.save();
    if (hatId === "tophat") {
      ctx.fillStyle = "#1a1a1a"; ctx.beginPath(); ctx.roundRect(-22, -30, 44, 7, 2); ctx.fill();
      ctx.fillStyle = "#111"; ctx.beginPath(); ctx.roundRect(-14, -30 - 34, 28, 34, 3); ctx.fill();
      ctx.fillStyle = "#2ecc71"; ctx.fillRect(-13, -30 - 12, 26, 7);
      ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.beginPath(); ctx.roundRect(-10, -30 - 32, 6, 30, 2); ctx.fill();
    } else if (hatId === "cap") {
      ctx.fillStyle = "#e74c3c";
      ctx.beginPath(); ctx.ellipse(0, -27, 21, 15, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-21, -27, 42, 8, [0, 0, 4, 4]); ctx.fill();
      ctx.fillStyle = "#c0392b"; ctx.beginPath(); ctx.ellipse(20, -24, 16, 6, 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-18, -36); ctx.lineTo(0, -42); ctx.lineTo(18, -36); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, -42, 3, 0, Math.PI * 2); ctx.fill();
    } else if (hatId === "crown") {
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.moveTo(-18, -26); ctx.lineTo(-18, -46); ctx.lineTo(-9, -37);
      ctx.lineTo(0, -51); ctx.lineTo(9, -37);
      ctx.lineTo(18, -46); ctx.lineTo(18, -26); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#e6ac00"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#e6ac00"; ctx.fillRect(-18, -30, 36, 6);
      ctx.fillStyle = "#e74c3c"; ctx.beginPath(); ctx.arc(0, -40, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3498db"; ctx.beginPath(); ctx.arc(-12, -29, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(12, -29, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath(); ctx.arc(-0.5, -41.5, 1.5, 0, Math.PI * 2); ctx.fill();
    } else if (hatId === "cowboy") {
      ctx.fillStyle = "#8B6914";
      ctx.beginPath(); ctx.ellipse(0, -30, 18, 16, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-18, -30, 36, 8, [0, 0, 4, 4]); ctx.fill();
      ctx.fillStyle = "#7A5C0E"; ctx.beginPath(); ctx.ellipse(0, -28, 32, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8B6914";
      ctx.beginPath(); ctx.ellipse(-26, -26, 7, 5, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(26, -26, 7, 5, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8B0000"; ctx.fillRect(-17, -34, 34, 6);
      ctx.fillStyle = "#ffd700"; ctx.beginPath(); ctx.roundRect(-4, -35, 8, 8, 1); ctx.fill();
    } else if (hatId === "viking") {
      ctx.fillStyle = "#888";
      ctx.beginPath(); ctx.ellipse(0, -30, 20, 17, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#777"; ctx.beginPath(); ctx.roundRect(-20, -30, 40, 8, [0, 0, 4, 4]); ctx.fill();
      ctx.fillStyle = "#777"; ctx.fillRect(-3, -30, 6, 14);
      ctx.fillStyle = "#aaa";
      [-12, 0, 12].forEach(function (rx) { ctx.beginPath(); ctx.arc(rx, -32, 2.5, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = "#f0e8d0";
      ctx.beginPath(); ctx.moveTo(-19, -36); ctx.quadraticCurveTo(-36, -52, -28, -66); ctx.quadraticCurveTo(-20, -50, -12, -38); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(19, -36); ctx.quadraticCurveTo(36, -52, 28, -66); ctx.quadraticCurveTo(20, -50, 12, -38); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#d4c0a0";
      ctx.beginPath(); ctx.ellipse(-28, -66, 4, 3, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(28, -66, 4, 3, -0.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---- Character drawing ----------------------------------------------------
  var SKIN = "#f2b079", SKIN_D = "#d88a4e", SKIN_DD = "#b86c34", SKIN_HI = "#ffd6a8", NAIL = "#fdeee2", NAIL_D = "#e6c2a8";

  function drawFingerLeg(ctx, hipX, hipY, swing, front) {
    var seg1 = 30, seg2 = 30;
    var kneeX = hipX + Math.sin(swing) * seg1;
    var kneeY = hipY + Math.cos(swing) * seg1;
    var bend = swing * 0.5 + (swing > 0 ? 0.34 : -0.12);
    var tipX = kneeX + Math.sin(bend) * seg2;
    var tipY = kneeY + Math.cos(bend) * seg2;
    var sk = front ? SKIN : SKIN_D;
    var skd = front ? SKIN_D : SKIN_DD;

    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = skd; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
    ctx.strokeStyle = sk;  ctx.lineWidth = 17; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
    ctx.fillStyle = skd; ctx.beginPath(); ctx.arc(kneeX, kneeY, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = sk;  ctx.beginPath(); ctx.arc(kneeX, kneeY, 8.5, 0, Math.PI * 2); ctx.fill();
    var ka = Math.atan2(kneeY - hipY, kneeX - hipX) + Math.PI / 2;
    ctx.strokeStyle = "rgba(150,80,40,0.40)"; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(kneeX + Math.cos(ka) * 7, kneeY + Math.sin(ka) * 7);
    ctx.lineTo(kneeX - Math.cos(ka) * 7, kneeY - Math.sin(ka) * 7);
    ctx.stroke();
    ctx.strokeStyle = skd; ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(tipX, tipY); ctx.stroke();
    ctx.strokeStyle = sk;  ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(tipX, tipY); ctx.stroke();
    ctx.fillStyle = skd; ctx.beginPath(); ctx.arc(tipX, tipY, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = sk;  ctx.beginPath(); ctx.arc(tipX, tipY, 7, 0, Math.PI * 2); ctx.fill();
    var nd = Math.atan2(tipY - kneeY, tipX - kneeX);
    ctx.save(); ctx.translate(tipX, tipY); ctx.rotate(nd - Math.PI / 2);
    ctx.fillStyle = NAIL_D; ctx.beginPath(); ctx.roundRect(-5.5, -10, 11, 11, 4); ctx.fill();
    ctx.fillStyle = NAIL;   ctx.beginPath(); ctx.roundRect(-4.5, -9, 9, 8.5, 3); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.beginPath(); ctx.roundRect(-3.5, -8.5, 3, 6, 2); ctx.fill();
    ctx.restore();
  }

  function drawFinger(ctx, playerY, time, _height, gameRunning, hatId, stretchX, stretchY) {
    if (stretchX === undefined) stretchX = 1;
    if (stretchY === undefined) stretchY = 1;
    var cx = 185;
    var strideSpeed = gameRunning ? 0.26 : 0.05;
    var stride = Math.sin(time * strideSpeed);
    var bodyBob = gameRunning ? Math.abs(stride) * -6 : Math.sin(time * 0.05) * 2;
    var palmY = playerY + bodyBob;
    var footY = playerY + FINGER_TIP_OFFSET;

    var lift = Math.max(0, footY - (palmY + 64));
    var shScale = Math.max(0.5, 1 - lift * 0.004);
    ctx.fillStyle = "rgba(0,0,0," + (0.20 * shScale) + ")";
    ctx.beginPath(); ctx.ellipse(cx, footY + 6, 34 * shScale, 7 * shScale, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(cx, footY);
    ctx.scale(stretchX, stretchY);
    ctx.translate(-cx, -footY);

    var baseY = palmY + 22;
    var indexSwing = stride * 0.6;
    var middleSwing = -stride * 0.6;

    drawFingerLeg(ctx, cx + 11, baseY, middleSwing, false);

    ctx.save();
    ctx.translate(cx, palmY);
    ctx.rotate(-0.06 + stride * 0.05);

    ctx.fillStyle = SKIN_D;  ctx.beginPath(); ctx.roundRect(-34, -30, 68, 60, 20); ctx.fill();
    ctx.fillStyle = SKIN;    ctx.beginPath(); ctx.roundRect(-32, -30, 62, 55, 18); ctx.fill();
    ctx.fillStyle = SKIN_HI; ctx.beginPath(); ctx.roundRect(-30, -30, 54, 15, [16, 16, 6, 6]); ctx.fill();

    ctx.strokeStyle = SKIN_D; ctx.lineCap = "round"; ctx.lineWidth = 13;
    ctx.beginPath(); ctx.arc(20, -8, 13, Math.PI * 1.15, Math.PI * 1.95); ctx.stroke();
    ctx.lineWidth = 11; ctx.beginPath(); ctx.arc(24, 8, 11, Math.PI * 1.1, Math.PI * 1.95); ctx.stroke();
    ctx.strokeStyle = "rgba(150,80,40,0.30)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(8, -16); ctx.lineTo(30, -12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(32, 6); ctx.stroke();

    ctx.fillStyle = SKIN_D; ctx.beginPath(); ctx.ellipse(-30, 9, 13, 17, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SKIN;   ctx.beginPath(); ctx.ellipse(-31, 6, 9.5, 13, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(-37, -3); ctx.rotate(-0.55);
    ctx.fillStyle = NAIL_D; ctx.beginPath(); ctx.roundRect(-5, -7, 10, 11, 3); ctx.fill();
    ctx.fillStyle = NAIL;   ctx.beginPath(); ctx.roundRect(-4, -6, 8, 9, 2); ctx.fill();
    ctx.restore();

    var blink = (Math.floor(time / 8) % 24 === 0) ? 0.15 : 1;
    var lookX = gameRunning ? 2.5 : 0;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(-10, -2, 7, 8 * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, -2, 7, 8 * blink, 0, 0, Math.PI * 2); ctx.fill();
    if (blink > 0.5) {
      ctx.fillStyle = "#2a2a2a";
      ctx.beginPath(); ctx.arc(-10 + lookX, -1, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(8 + lookX, -1, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(-11 + lookX, -2.5, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(7 + lookX, -2.5, 1.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = SKIN_DD; ctx.lineWidth = 2.6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-16, -12); ctx.lineTo(-5, -10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, -12); ctx.lineTo(5, -10); ctx.stroke();

    drawHat(ctx, hatId);
    ctx.restore();

    drawFingerLeg(ctx, cx - 11, baseY, indexSwing, true);

    ctx.restore();
  }

  // ---- Speech bubble --------------------------------------------------------
  function drawSpeechBubble(ctx, x, y, text, alpha) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = "bold 16px Arial";
    var w = Math.min(300, ctx.measureText(text).width + 28);
    var h = 36;
    var bx = x - w / 2, by = y - h;
    ctx.shadowColor = "rgba(0,0,0,0.25)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.roundRect(bx, by, w, h, 12); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 9, by + h - 1); ctx.lineTo(x + 9, by + h - 1); ctx.lineTo(x - 2, by + h + 13); ctx.closePath(); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#222"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, x, by + h / 2);
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  // ---- Canvas + loop --------------------------------------------------------
  var canvas = document.getElementById("c");
  var ctx = canvas.getContext("2d");
  var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  var VW = 0, VH = 0;

  function resize() {
    VW = window.innerWidth;
    VH = window.innerHeight;
    canvas.style.width = VW + "px";
    canvas.style.height = VH + "px";
    canvas.width = Math.round(VW * dpr);
    canvas.height = Math.round(VH * dpr);
    if (!st.gameRunning) st.playerY = getGroundY(VH);
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

      if (st.dialog && st.dialog.life > 0) st.dialog.life--;
      st.dialogCooldown--;
      if (st.dialogCooldown <= 0 && (!st.dialog || st.dialog.life <= 0)) {
        showDialog(pick(RUN_QUIPS), 130);
        st.dialogCooldown = 260 + Math.floor(Math.random() * 220);
      }
      if (st.shake > 0) { st.shake *= 0.86; if (st.shake < 0.4) st.shake = 0; }

      st.spawnTimer++;
      var spawnRate = Math.max(lvlDef.minSpawn, 220 - Math.floor(st.levelScore / 6));
      if (st.spawnTimer > spawnRate) { spawnObstacle(width); st.spawnTimer = 0; }

      var fingerLeft = 168; var fingerRight = 202;
      var fingerTipY = st.playerY + FINGER_TIP_OFFSET - 8;
      var speed = BASE_SPEED * lvlDef.speedMult + st.levelScore * 0.001;
      var didCrash = false;
      for (i = st.obstacles.length - 1; i >= 0; i--) {
        var o = st.obstacles[i];
        o.x -= speed;
        if (!didCrash) {
          var obsTop = roadY - o.obsHeight;
          if (fingerRight > o.x && fingerLeft < o.x + o.obsWidth && fingerTipY > obsTop) {
            crash(); didCrash = true;
          }
        }
        if (!o.passed && o.x + o.obsWidth * 0.55 < fingerLeft) o.passed = true;
        if (o.x < -150) st.obstacles.splice(i, 1);
      }

      for (i = st.particles.length - 1; i >= 0; i--) {
        p = st.particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.life--;
        if (p.rot !== undefined && p.rotV !== undefined) p.rot += p.rotV;
        if (p.shape === "circle" && p.y >= roadY - 6) { p.y = roadY - 6; p.vy = 0; p.vx *= 0.7; }
        if (p.life <= 0) st.particles.splice(i, 1);
      }
      var scrollSpeed = BASE_SPEED * lvlDef.speedMult + st.levelScore * 0.001;
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

    // ---- Draw ----
    drawBackground(ctx, width, height, st.time, theme);

    ctx.save();
    if (st.shake > 0) {
      ctx.translate((Math.random() - 0.5) * st.shake, (Math.random() - 0.5) * st.shake);
    }

    for (i = 0; i < st.bloodPuddles.length; i++) {
      bp = st.bloodPuddles[i];
      var alphaB = Math.min(0.82, (bp.life / bp.maxLife) * 0.82);
      ctx.globalAlpha = alphaB;
      var pg = ctx.createRadialGradient(bp.x, bp.y, 0, bp.x, bp.y, bp.rx);
      pg.addColorStop(0, "#8B0000"); pg.addColorStop(0.6, "#6B0000"); pg.addColorStop(1, "rgba(50,0,0,0)");
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.ellipse(bp.x, bp.y, bp.rx, bp.ry, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (i = 0; i < st.obstacles.length; i++) drawObstacle(ctx, st.obstacles[i], height);

    ctx.shadowBlur = 0;
    for (i = 0; i < st.particles.length; i++) {
      p = st.particles[i];
      var alphaP = Math.max(0.08, p.life / 70);
      ctx.globalAlpha = alphaP;
      ctx.fillStyle = p.color;
      if (p.shape === "circle") {
        ctx.beginPath(); ctx.arc(p.x, p.y, (p.size || 6) / 2, 0, Math.PI * 2); ctx.fill();
      } else if (p.shape === "bone") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
        var rr = (p.size || 6) / 2;
        ctx.fillRect(-rr, -rr * 0.35, rr * 2, rr * 0.7);
        ctx.beginPath(); ctx.arc(-rr, 0, rr * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(rr, 0, rr * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        ctx.fillRect(p.x, p.y, p.size || 6, p.size || 6);
      }
    }
    ctx.globalAlpha = 1;

    var hat = getEquippedHat();
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
    drawFinger(ctx, st.playerY, st.time, height, st.gameRunning, hat, stretchX, stretchY);

    if (st.dialog && st.dialog.life > 0) {
      var d = st.dialog;
      var fadeIn = Math.min(1, (d.maxLife - d.life) / 8);
      var fadeOut = Math.min(1, d.life / 20);
      var bubbleY = st.playerY - 26 + Math.sin(st.time * 0.1) * 2;
      drawSpeechBubble(ctx, 185, bubbleY, d.text, Math.min(fadeIn, fadeOut));
    }

    ctx.restore();

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
    ctx.shadowBlur = 0;

    if (!st.gameRunning && !st.levelComplete && st.totalScore > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.beginPath(); ctx.roundRect(width / 2 - 250, height / 2 - 145, 500, 290, 20); ctx.fill();
      ctx.fillStyle = "#ff6b6b"; ctx.textAlign = "center";
      ctx.font = "bold 48px Arial"; ctx.fillText("OUCH! \\uD83E\\uDD15", width / 2, height / 2 - 70);
      ctx.fillStyle = "#fff"; ctx.font = "bold 26px Arial";
      ctx.fillText("Level " + st.currentLevel + ": " + Math.floor(st.levelScore) + " / " + lvlDef.target, width / 2, height / 2 - 26);
      ctx.fillStyle = "#aaa"; ctx.font = "20px Arial";
      ctx.fillText("Total distance: " + Math.floor(st.totalScore), width / 2, height / 2 + 10);
      if (Math.floor(st.totalScore) >= st.bestScore && st.totalScore > 5) {
        ctx.fillStyle = "#ffd700"; ctx.font = "bold 24px Arial"; ctx.fillText("\\u2605 NEW RECORD! \\u2605", width / 2, height / 2 + 48);
      }
      ctx.fillStyle = "#ddd"; ctx.font = "20px Arial";
      ctx.fillText("Tap to retry this level", width / 2, height / 2 + 110);
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
  canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); handleCanvasTap(); }, { passive: false });
  canvas.addEventListener("pointerup", function (e) { e.preventDefault(); releaseJump(); }, { passive: false });
  canvas.addEventListener("pointercancel", function () { releaseJump(); });
  canvas.addEventListener("pointerleave", function () { releaseJump(); });
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  document.addEventListener("dblclick", function (e) { e.preventDefault(); });
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  // ---- UI overlays ----------------------------------------------------------
  var ui = { screen: "start", completedLevel: 0, unlockedHat: null };
  var overlaysEl = document.getElementById("overlays");
  var musicBtn = document.getElementById("musicBtn");

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
      html += '<p style="font-size:1.05rem;margin:4px 0;">Tap to jump \\u2022 hold for a higher jump \\u2022 double-tap to double jump \\u2022 Clear 8 levels</p>';
      html += '<p style="font-size:1rem;margin:4px 0;color:#aef;">' + unlockedEmojis + ' outfits unlocked \\u2022 reach new levels to earn more!</p>';
      html += '<div style="display:flex;gap:14px;margin-top:24px;flex-wrap:wrap;justify-content:center;">';
      html += '<button class="pressable" data-act="start1" style="padding:16px 38px;font-size:1.35rem;background:#ff4757;color:#fff;border:none;border-radius:60px;box-shadow:0 8px 0 #c2363e;font-weight:bold;">START RUNNING</button>';
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
      html += '<div class="overlay scroll" style="background:rgba(10,10,30,0.92);color:#fff;">';
      html += '<div style="background:rgba(255,255,255,0.07);border-radius:24px;padding:28px 28px;max-width:540px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.6);">';
      html += '<h2 style="font-size:1.8rem;margin:0 0 6px 0;color:#ffd700;text-align:center;">\\uD83D\\uDC55 WARDROBE</h2>';
      html += '<p style="color:#aaa;text-align:center;margin:0 0 20px 0;">Unlock hats by reaching new levels</p>';
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
      html += '<button class="pressable" data-act="menu" style="margin-top:20px;width:100%;padding:14px;font-size:1.05rem;font-weight:bold;background:#444;color:#fff;border:none;border-radius:40px;">\\u2190 Back</button>';
      html += '</div></div>';
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
          else if (act === "menu") setScreen("start");
          else if (act === "startlv") startLevel(parseInt(btn.getAttribute("data-lv"), 10));
          else if (act === "equip") { setEquippedHat(btn.getAttribute("data-hat")); renderOverlays(); }
        });
      })(btns[i]);
    }
  }

  // ---- Music toggle ---------------------------------------------------------
  function updateMusicBtn() { musicBtn.innerHTML = "\\uD83C\\uDFB5 " + (audio.enabled ? "ON" : "OFF"); }
  musicBtn.addEventListener("click", function () {
    audio.enabled = !audio.enabled;
    updateMusicBtn();
    if (audio.enabled) startMusic(st.gameRunning); else stopMusic();
  });

  // ---- Boot -----------------------------------------------------------------
  updateMusicBtn();
  setScreen("start");
  requestAnimationFrame(loop);
  setTimeout(function () { if (audio.enabled) startMusic(false); }, 650);
})();
</script>
</body>
</html>`;
