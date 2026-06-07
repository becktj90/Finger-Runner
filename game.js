/* ===== WINDOW RUNNER V1 - PRODUCTION BUILD ===== */

// ==================== CONFIG ====================
const CONFIG = {
  CANVAS_WIDTH: 960,
  CANVAS_HEIGHT: 540,
  GRAVITY: 0.6,
  GROUND_Y: 420,
  PLAYER_WIDTH: 32,
  PLAYER_HEIGHT: 60,
  JUMP_POWER: 12,
  SLIDE_DURATION: 300,
  DOUBLE_JUMP_POWER: 11,
  BASE_SPEED: 6,
  MAX_SPEED: 12,
  SPAWN_RATE: 0.04,
  PARTICLE_LIFE: 30,
};

// ==================== STATE MANAGEMENT ====================
const GameState = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'gameOver',
};

let gameState = GameState.MENU;

// ==================== PERSISTENCE ====================
const SaveData = {
  highScore: 0,
  totalCoins: 0,
  gamesPlayed: 0,
  selectedFinger: 'classic',
  selectedTrail: 'none',
  soundEnabled: true,
  musicEnabled: true,
  reduceMotion: false,

  load() {
    const data = localStorage.getItem('windowRunnerSave');
    if (data) {
      Object.assign(this, JSON.parse(data));
    }
  },

  save() {
    localStorage.setItem('windowRunnerSave', JSON.stringify({
      highScore: this.highScore,
      totalCoins: this.totalCoins,
      gamesPlayed: this.gamesPlayed,
      selectedFinger: this.selectedFinger,
      selectedTrail: this.selectedTrail,
      soundEnabled: this.soundEnabled,
      musicEnabled: this.musicEnabled,
      reduceMotion: this.reduceMotion,
    }));
  },

  clear() {
    localStorage.removeItem('windowRunnerSave');
    this.highScore = 0;
    this.totalCoins = 0;
    this.gamesPlayed = 0;
    this.save();
  },
};

SaveData.load();

// ==================== AUDIO ENGINE ====================
const AudioEngine = {
  audioContext: null,

  init() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
  },

  playTone(frequency, duration, type = 'sine') {
    if (!SaveData.soundEnabled) return;
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const now = this.audioContext.currentTime;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.connect(gain);
    gain.connect(this.audioContext.destination);

    osc.frequency.value = frequency;
    osc.type = type;

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  },

  jump() {
    this.playTone(440, 0.1);
    this.playTone(600, 0.15, 'square');
  },

  land() {
    this.playTone(200, 0.08);
  },

  coin() {
    this.playTone(800, 0.1);
    this.playTone(1000, 0.1);
  },

  crash() {
    this.playTone(100, 0.2);
    this.playTone(80, 0.2);
  },

  menuClick() {
    this.playTone(400, 0.05);
  },
};

// ==================== PARTICLE SYSTEM ====================
class Particle {
  constructor(x, y, vx, vy, life = CONFIG.PARTICLE_LIFE) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = life;
    this.size = 4;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.3;
    this.life--;
  }

  draw(ctx) {
    const alpha = this.life / this.maxLife;
    ctx.fillStyle = `rgba(255, 200, 100, ${alpha * 0.8})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
  }

  isAlive() {
    return this.life > 0;
  }
}

// ==================== PLAYER ====================
class Player {
  constructor() {
    this.x = 100;
    this.y = CONFIG.GROUND_Y;
    this.width = CONFIG.PLAYER_WIDTH;
    this.height = CONFIG.PLAYER_HEIGHT;
    this.vy = 0;
    this.onGround = true;
    this.sliding = false;
    this.slideTimer = 0;
    this.canDoubleJump = true;
    this.lastJumpTime = 0;
    this.animationFrame = 0;
    this.screenShake = 0;
  }

  jump() {
    if (this.onGround) {
      this.vy = -CONFIG.JUMP_POWER;
      this.onGround = false;
      this.canDoubleJump = true;
      this.lastJumpTime = Date.now();
      AudioEngine.jump();
      return true;
    } else if (this.canDoubleJump && !this.sliding) {
      this.vy = -CONFIG.DOUBLE_JUMP_POWER;
      this.canDoubleJump = false;
      AudioEngine.jump();
      return true;
    }
    return false;
  }

  slide() {
    if (this.onGround && !this.sliding) {
      this.sliding = true;
      this.slideTimer = CONFIG.SLIDE_DURATION;
    }
  }

  update() {
    this.vy += CONFIG.GRAVITY;
    this.y += this.vy;

    if (this.y >= CONFIG.GROUND_Y) {
      this.y = CONFIG.GROUND_Y;
      this.vy = 0;
      if (!this.onGround) {
        AudioEngine.land();
        this.createLandingDust();
      }
      this.onGround = true;
    }

    if (this.sliding) {
      this.slideTimer--;
      if (this.slideTimer <= 0) {
        this.sliding = false;
      }
    }

    this.animationFrame++;
  }

  createLandingDust() {
    for (let i = 0; i < 5; i++) {
      const angle = (Math.random() - 0.5) * Math.PI;
      const speed = 2 + Math.random() * 3;
      particles.push(new Particle(
        this.x + this.width / 2,
        this.y + this.height,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 1,
        20
      ));
    }
  }

  draw(ctx) {
    const height = this.sliding ? this.height * 0.5 : this.height;
    const y = this.sliding ? CONFIG.GROUND_Y + this.height * 0.5 : this.y;

    ctx.fillStyle = '#f1c27d';
    ctx.fillRect(this.x, y, this.width, height);

    if (!this.sliding) {
      const legOffset = Math.sin(this.animationFrame * 0.1) * 2;
      ctx.fillStyle = '#d4a574';
      ctx.fillRect(this.x + 4, y + height - 20, 8, 20 + legOffset);
      ctx.fillRect(this.x + 20, y + height - 20, 8, 20 - legOffset);

      const eyeSize = 3;
      ctx.fillStyle = '#000';
      ctx.fillRect(this.x + 6, y + 8, eyeSize, eyeSize);
      ctx.fillRect(this.x + 18, y + 8, eyeSize, eyeSize);
    }
  }

  getHitbox() {
    if (this.sliding) {
      return {
        x: this.x,
        y: CONFIG.GROUND_Y + this.height * 0.5,
        width: this.width,
        height: this.height * 0.5,
      };
    }
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };
  }
}

// ==================== OBSTACLE SYSTEM ====================
class Obstacle {
  constructor(x, y, width, height, type) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.type = type;
    this.passed = false;
  }

  update(speed) {
    this.x -= speed;
  }

  draw(ctx) {
    switch (this.type) {
      case 'mailbox':
        this.drawMailbox(ctx);
        break;
      case 'hydrant':
        this.drawHydrant(ctx);
        break;
      case 'cone':
        this.drawCone(ctx);
        break;
      case 'sign':
        this.drawSign(ctx);
        break;
      case 'fence':
        this.drawFence(ctx);
        break;
      case 'rock':
        this.drawRock(ctx);
        break;
      case 'bird':
        this.drawBird(ctx);
        break;
      case 'dog':
        this.drawDog(ctx);
        break;
      default:
        ctx.fillStyle = '#cc3333';
        ctx.fillRect(this.x, this.y, this.width, this.height);
    }
  }

  drawMailbox(ctx) {
    ctx.fillStyle = '#cc0000';
    ctx.fillRect(this.x + 2, this.y + 10, this.width - 4, this.height - 10);
    ctx.fillStyle = '#990000';
    ctx.beginPath();
    ctx.arc(this.x + this.width / 2, this.y + 10, this.width / 2, Math.PI, 0);
    ctx.fill();
  }

  drawHydrant(ctx) {
    ctx.fillStyle = '#ff6600';
    ctx.fillRect(this.x + 8, this.y + 15, 8, this.height - 15);
    ctx.beginPath();
    ctx.arc(this.x + 12, this.y + 15, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(this.x + 6, this.y + 20, 12, 4);
  }

  drawCone(ctx) {
    ctx.fillStyle = '#ff8800';
    ctx.beginPath();
    ctx.moveTo(this.x + this.width / 2, this.y);
    ctx.lineTo(this.x + this.width, this.y + this.height);
    ctx.lineTo(this.x, this.y + this.height);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(this.x + 4, this.y + this.height / 2, this.width - 8, 3);
  }

  drawSign(ctx) {
    ctx.fillStyle = '#885533';
    ctx.fillRect(this.x + this.width / 2 - 2, this.y + 10, 4, this.height - 10);
    ctx.fillStyle = '#0066cc';
    ctx.fillRect(this.x + 2, this.y, this.width - 4, 10);
  }

  drawFence(ctx) {
    ctx.fillStyle = '#8b6914';
    for (let i = 0; i < this.width; i += 6) {
      ctx.fillRect(this.x + i, this.y, 3, this.height);
    }
    ctx.fillRect(this.x, this.y + this.height / 2, this.width, 2);
  }

  drawRock(ctx) {
    ctx.fillStyle = '#666666';
    ctx.beginPath();
    ctx.arc(this.x + this.width / 2, this.y + this.height / 2, this.width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#888888';
    ctx.beginPath();
    ctx.arc(this.x + this.width / 3, this.y + this.height / 3, this.width / 4, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBird(ctx) {
    ctx.fillStyle = '#333333';
    ctx.beginPath();
    ctx.arc(this.x + 4, this.y + 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff6600';
    ctx.beginPath();
    ctx.moveTo(this.x + 8, this.y + 5);
    ctx.lineTo(this.x + 10, this.y + 4);
    ctx.lineTo(this.x + 8, this.y + 6);
    ctx.closePath();
    ctx.fill();
  }

  drawDog(ctx) {
    ctx.fillStyle = '#8b6f47';
    ctx.beginPath();
    ctx.arc(this.x + 8, this.y + 10, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(this.x + 2, this.y + 10, 12, 10);
    ctx.fillRect(this.x + 3, this.y + 18, 2, 4);
    ctx.fillRect(this.x + 10, this.y + 18, 2, 4);
  }

  getHitbox() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  isOffScreen() {
    return this.x + this.width < 0;
  }
}

// ==================== COIN SYSTEM ====================
class Coin {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.collected = false;
    this.rotation = 0;
    this.bobOffset = 0;
  }

  update() {
    this.x -= CONFIG.BASE_SPEED;
    this.rotation += 0.1;
    this.bobOffset = Math.sin(this.rotation) * 3;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y + this.bobOffset);
    ctx.rotate(this.rotation);

    ctx.fillStyle = '#ffdd00';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  getHitbox() {
    return { x: this.x - 6, y: this.y - 6, width: 12, height: 12 };
  }

  isOffScreen() {
    return this.x < 0;
  }
}

// ==================== GAME ENGINE ====================
let canvas, ctx;
let player;
let obstacles = [];
let coins = [];
let particles = [];
let currentSpeed = CONFIG.BASE_SPEED;
let gameDistance = 0;
let gameCoins = 0;
let gameScore = 0;
let gameOver = false;
let paused = false;
let spawnTimer = 0;
let screenShakeAmount = 0;

const inputState = {
  jumpPressed: false,
  slidePressed: false,
  lastTapTime: 0,
  tapCount: 0,
};

function resetGame() {
  player = new Player();
  obstacles = [];
  coins = [];
  particles = [];
  currentSpeed = CONFIG.BASE_SPEED;
  gameDistance = 0;
  gameCoins = 0;
  gameScore = 0;
  gameOver = false;
  paused = false;
  spawnTimer = 0;
  screenShakeAmount = 0;
  inputState.jumpPressed = false;
  inputState.slidePressed = false;
}

function spawnObstacle() {
  const types = ['mailbox', 'hydrant', 'cone', 'sign', 'fence', 'rock', 'bird', 'dog'];
  const type = types[Math.floor(Math.random() * types.length)];
  const heights = {
    mailbox: 40,
    hydrant: 50,
    cone: 50,
    sign: 40,
    fence: 35,
    rock: 30,
    bird: 20,
    dog: 30,
  };

  const height = heights[type];
  const y = CONFIG.GROUND_Y + 10 - height;

  obstacles.push(new Obstacle(CONFIG.CANVAS_WIDTH, y, 25, height, type));

  if (Math.random() < 0.3) {
    coins.push(new Coin(CONFIG.CANVAS_WIDTH, y - 40));
  }
}

function update() {
  if (gameState !== GameState.PLAYING) return;

  player.update();

  currentSpeed = Math.min(CONFIG.BASE_SPEED + gameDistance * 0.001, CONFIG.MAX_SPEED);

  obstacles.forEach((obs) => {
    obs.update(currentSpeed);

    if (!obs.passed && obs.x + obs.width < player.x) {
      obs.passed = true;
      gameScore += Math.floor(currentSpeed);
      gameDistance += 1;
    }
  });

  coins.forEach((coin) => {
    coin.update();

    if (!coin.collected && checkCollision(player.getHitbox(), coin.getHitbox())) {
      coin.collected = true;
      gameCoins += 1;
      SaveData.totalCoins++;
      AudioEngine.coin();
      screenShakeAmount = 3;
    }
  });

  obstacles = obstacles.filter((obs) => !obs.isOffScreen());
  coins = coins.filter((coin) => !coin.isOffScreen() || !coin.collected);

  particles = particles.filter((p) => p.isAlive());
  particles.forEach((p) => p.update());

  spawnTimer++;
  if (spawnTimer > 1 / CONFIG.SPAWN_RATE) {
    spawnObstacle();
    spawnTimer = 0;
  }

  obstacles.forEach((obs) => {
    if (checkCollision(player.getHitbox(), obs.getHitbox())) {
      endGame();
    }
  });

  if (screenShakeAmount > 0) {
    screenShakeAmount *= 0.9;
  }
}

function draw() {
  ctx.save();

  if (screenShakeAmount > 0) {
    const shake = screenShakeAmount;
    ctx.translate(
      (Math.random() - 0.5) * shake,
      (Math.random() - 0.5) * shake
    );
  }

  ctx.fillStyle = 'rgba(135, 206, 235, 0.8)';
  ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

  ctx.fillStyle = '#228B22';
  ctx.fillRect(0, CONFIG.GROUND_Y + 10, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_Y - 10);

  ctx.fillStyle = '#999999';
  ctx.fillRect(0, CONFIG.GROUND_Y, CONFIG.CANVAS_WIDTH, 10);

  for (let i = 0; i < CONFIG.CANVAS_WIDTH; i += 40) {
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(i, CONFIG.GROUND_Y + 3, 20, 4);
  }

  coins.forEach((coin) => {
    if (!coin.collected) coin.draw(ctx);
  });

  obstacles.forEach((obs) => obs.draw(ctx));
  particles.forEach((p) => p.draw(ctx));

  player.draw(ctx);

  ctx.restore();
}

function gameLoop() {
  update();
  draw();

  updateHUD();

  requestAnimationFrame(gameLoop);
}

function checkCollision(rect1, rect2) {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  );
}

function endGame() {
  gameState = GameState.GAME_OVER;
  AudioEngine.crash();

  if (gameScore > SaveData.highScore) {
    SaveData.highScore = gameScore;
  }
  SaveData.gamesPlayed++;
  SaveData.save();

  showGameOverScreen();
}

// ==================== UI MANAGEMENT ====================
function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function updateHUD() {
  if (gameState === GameState.PLAYING) {
    document.getElementById('hudDistance').textContent = Math.floor(gameDistance);
    document.getElementById('hudCoins').textContent = gameCoins;
  }
}

function showGameOverScreen() {
  document.getElementById('finalDistance').textContent = Math.floor(gameDistance);
  document.getElementById('finalCoins').textContent = gameCoins;
  document.getElementById('finalScore').textContent = Math.floor(gameScore);

  const newHighScore = gameScore > SaveData.highScore;
  document.getElementById('newHighScoreMessage').style.display = newHighScore ? 'block' : 'none';

  switchScreen('gameOverScreen');
}

function updateStatsDisplay() {
  document.getElementById('displayHighScore').textContent = Math.floor(SaveData.highScore);
  document.getElementById('displayTotalCoins').textContent = SaveData.totalCoins;
  document.getElementById('displayGamesPlayed').textContent = SaveData.gamesPlayed;
}

// ==================== EVENT LISTENERS ====================
document.getElementById('playButton').addEventListener('click', () => {
  AudioEngine.menuClick();
  resetGame();
  gameState = GameState.PLAYING;
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById('hud').classList.remove('hidden');
  AudioEngine.init();
});

document.getElementById('howToButton').addEventListener('click', () => {
  AudioEngine.menuClick();
  switchScreen('howToScreen');
});

document.getElementById('settingsButton').addEventListener('click', () => {
  AudioEngine.menuClick();
  switchScreen('settingsScreen');
});

document.getElementById('statsButton').addEventListener('click', () => {
  AudioEngine.menuClick();
  updateStatsDisplay();
  switchScreen('statsScreen');
});

document.getElementById('backFromHow').addEventListener('click', () => {
  AudioEngine.menuClick();
  switchScreen('mainMenu');
});

document.getElementById('backFromSettings').addEventListener('click', () => {
  AudioEngine.menuClick();
  switchScreen('mainMenu');
});

document.getElementById('backFromStats').addEventListener('click', () => {
  AudioEngine.menuClick();
  switchScreen('mainMenu');
});

document.getElementById('clearStats').addEventListener('click', () => {
  if (confirm('Clear all save data? This cannot be undone.')) {
    AudioEngine.menuClick();
    SaveData.clear();
    updateStatsDisplay();
  }
});

document.getElementById('pauseButton').addEventListener('click', () => {
  if (gameState === GameState.PLAYING) {
    AudioEngine.menuClick();
    gameState = GameState.PAUSED;
    switchScreen('pauseMenu');
  }
});

document.getElementById('resumeButton').addEventListener('click', () => {
  AudioEngine.menuClick();
  gameState = GameState.PLAYING;
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
});

document.getElementById('quitButton').addEventListener('click', () => {
  AudioEngine.menuClick();
  gameState = GameState.MENU;
  document.getElementById('hud').classList.add('hidden');
  switchScreen('mainMenu');
});

document.getElementById('retryButton').addEventListener('click', () => {
  AudioEngine.menuClick();
  resetGame();
  gameState = GameState.PLAYING;
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById('hud').classList.remove('hidden');
});

document.getElementById('menuButton').addEventListener('click', () => {
  AudioEngine.menuClick();
  gameState = GameState.MENU;
  document.getElementById('hud').classList.add('hidden');
  switchScreen('mainMenu');
});

document.getElementById('soundToggle').addEventListener('change', (e) => {
  SaveData.soundEnabled = e.target.checked;
  SaveData.save();
});

document.getElementById('musicToggle').addEventListener('change', (e) => {
  SaveData.musicEnabled = e.target.checked;
  SaveData.save();
});

document.getElementById('reduceMotionToggle').addEventListener('change', (e) => {
  SaveData.reduceMotion = e.target.checked;
  SaveData.save();
});

// ==================== INPUT HANDLING ====================
document.addEventListener('keydown', (e) => {
  if (gameState !== GameState.PLAYING) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (!inputState.jumpPressed) {
      inputState.jumpPressed = true;
      player.jump();
    }
  }

  if (e.code === 'ArrowDown') {
    e.preventDefault();
    player.slide();
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    inputState.jumpPressed = false;
  }
});

canvas.addEventListener('touchstart', (e) => {
  if (gameState !== GameState.PLAYING) return;

  e.preventDefault();
  const now = Date.now();

  if (now - inputState.lastTapTime < 300) {
    inputState.tapCount++;
    if (inputState.tapCount === 2) {
      player.jump();
      inputState.tapCount = 0;
    }
  } else {
    inputState.tapCount = 1;
    player.jump();
  }

  inputState.lastTapTime = now;
});

canvas.addEventListener('touchmove', (e) => {
  if (gameState !== GameState.PLAYING) return;

  e.preventDefault();
  if (e.touches.length > 0) {
    const touch = e.touches[0];
    if (touch.clientY > canvas.getBoundingClientRect().top + canvas.clientHeight * 0.6) {
      player.slide();
    }
  }
});

// ==================== INITIALIZATION ====================
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');

  canvas.width = CONFIG.CANVAS_WIDTH;
  canvas.height = CONFIG.CANVAS_HEIGHT;

  AudioEngine.init();
  switchScreen('mainMenu');
  gameLoop();
});

window.addEventListener('orientationchange', () => {
  canvas.width = CONFIG.CANVAS_WIDTH;
  canvas.height = CONFIG.CANVAS_HEIGHT;
});