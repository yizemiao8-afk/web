/* =====================================================================
 * 灯芯镇最后的灯 · Web Demo
 * 从 Godot 项目 1:1 移植：开始菜单 → 开场 CG → 第一关
 * 虚拟分辨率 1152×648（与 Godot 默认窗口一致）
 * ===================================================================== */
"use strict";

const VW = 1152, VH = 648;
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

/* ---------- 资源加载 ---------- */
const IMG = {};
const imageManifest = {
  bg0: "assets/bg/0.webp", bg2: "assets/bg/2.webp", bg4: "assets/bg/4.webp",
  idle: "assets/player/idle2.webp", walk: "assets/player/walk.webp",
  circle: "assets/fx/circle.webp", ember: "assets/fx/ember.webp",
  tileset: "assets/tile/tileset2.webp", lamp: "assets/light/lamp.webp",
  title: "assets/menu/title.webp",
  cg1: "assets/cg/1.webp", cg2: "assets/cg/2.webp", cg3: "assets/cg/3.webp", cg4: "assets/cg/4.webp",
  cg5: "assets/cg/5.webp", cg6: "assets/cg/6.webp", cg7: "assets/cg/7.webp", cg8: "assets/cg/8.webp",
};
const menuSeq = []; // 35 帧菜单背景动画
for (let i = 0; i < 35; i++) imageManifest["seq" + i] = `assets/menu/seq/${String(i).padStart(2, "0")}.webp`;

const BGM = {
  menu: new Audio("assets/bgm/menu.mp3"),
  cg: new Audio("assets/bgm/cg.mp3"),
  level: new Audio("assets/bgm/level.mp3"),       // 第一版（轻松日常）：进入游戏画面后循环
};
BGM.menu.loop = true; BGM.cg.loop = true; BGM.level.loop = true;
// 音效：脚步声（行走时循环）
const SFX = {
  steps: new Audio("assets/sfx/footsteps.mp3"),
};
SFX.steps.loop = true;
SFX.steps.volume = 0.55;

let loaded = 0, loadTotal = 0;
function loadImages() {
  const jobs = Object.entries(imageManifest).map(([key, src]) => new Promise((res) => {
    loadTotal++;
    const im = new Image();
    im.onload = () => { loaded++; IMG[key] = im; res(); };
    im.onerror = () => { loaded++; console.warn("图片加载失败", src); IMG[key] = null; res(); };
    im.src = src;
  }));
  return Promise.all(jobs);
}

/* ---------- 音频（浏览器自动播放限制：首次交互后解锁） ---------- */
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (currentScene && currentScene.bgm) fadeVolume(currentScene.bgm, currentScene.bgmTarget ?? 1, 1.2);
}
window.addEventListener("pointerdown", unlockAudio, { once: false });
window.addEventListener("keydown", unlockAudio, { once: false });

function fadeVolume(audio, target, dur) {
  const start = audio.volume, t0 = performance.now();
  if (audio.paused) { audio.volume = start; audio.play().catch(() => {}); }
  function step(now) {
    const k = Math.min(1, (now - t0) / (dur * 1000));
    audio.volume = Math.max(0, Math.min(1, start + (target - start) * k));
    if (k < 1) requestAnimationFrame(step);
    else if (target === 0) audio.pause();
  }
  requestAnimationFrame(step);
}

/* ---------- 画布缩放（contain，保持 1152×648 比例） ---------- */
const ui = document.getElementById("ui");
function resize() {
  const s = Math.min(window.innerWidth / VW, window.innerHeight / VH);
  canvas.style.width = VW * s + "px";
  canvas.style.height = VH * s + "px";
  ui.style.transform = `scale(${s})`;
}
window.addEventListener("resize", resize);
resize();

/* ---------- 输入 ---------- */
const keys = {};
const ACTIONS = {
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  jump: ["Space", "ArrowUp", "KeyW"],
  light: ["KeyE"],
};
const pressed = {}; // 本帧刚按下
window.addEventListener("keydown", (e) => {
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });
function actionDown(name) { return ACTIONS[name].some((c) => keys[c]); }
function actionPressed(name) { return ACTIONS[name].some((c) => pressed[c]); }
let clickPressed = false;

/* ---------- 触屏手势（手机端完全手势控制） ----------
 * 按住左半屏 → 向左走；按住右半屏 → 向右走（支持多指、滑动换区）
 * 快速上滑 → 跳跃；靠近路灯时右下角出现「点灯」按钮
 * 菜单 / CG / 对话：点按 = 点击 / 推进（clickPressed） */
const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
const touchCtl = { move: 0, jump: false }; // move: -1/0/1；jump: 边沿触发，主循环末尾清除
const touchPointers = new Map(); // pointerId -> {x, y, t, zone}

function refreshTouchMove() {
  let l = 0, r = 0;
  for (const p of touchPointers.values()) { if (p.zone === "L") l = 1; else r = 1; }
  touchCtl.move = r - l;
}
canvas.addEventListener("pointerdown", (e) => {
  clickPressed = true;
  if (e.pointerType !== "touch") return;
  touchPointers.set(e.pointerId, {
    x: e.clientX, y: e.clientY, t: performance.now(),
    zone: e.clientX < window.innerWidth / 2 ? "L" : "R",
  });
  refreshTouchMove();
});
ui.addEventListener("pointerdown", () => { clickPressed = true; });
window.addEventListener("pointermove", (e) => {
  const p = touchPointers.get(e.pointerId);
  if (!p) return;
  p.zone = e.clientX < window.innerWidth / 2 ? "L" : "R";
  refreshTouchMove();
});
function endTouchPointer(e) {
  const p = touchPointers.get(e.pointerId);
  if (!p) return;
  touchPointers.delete(e.pointerId);
  const dt = performance.now() - p.t, dy = e.clientY - p.y;
  if (dt < 450 && dy < -50) touchCtl.jump = true; // 快速上滑 → 跳跃
  refreshTouchMove();
}
window.addEventListener("pointerup", endTouchPointer);
window.addEventListener("pointercancel", endTouchPointer);

/* ---------- 摄像头手势控制（MediaPipe GestureRecognizer，复用星盘小游戏的本地模型） ----------
 * 与键盘 / 触屏并存的第三条输入通道：
 *   🖐 Open_Palm（边沿）   → 菜单开始 / CG 下一张 / 对话推进
 *   手掌左右位置（镜像后） → 关卡移动：画面左 1/3 左移，右 1/3 右移，中间死区
 *   ☝️ Pointing_Up（边沿） → 跳跃
 *   👍 Thumb_Up（边沿）    → 靠近路灯时打开星盘解密
 * 按 C 切换摄像头小窗显隐。星盘小游戏打开期间主页面暂停识别（摄像头让给 iframe）。 */
const camVideo = document.getElementById("cam-preview");
const gestureStatus = document.getElementById("gesture-status");
let recognizer = null;
let gestureReady = false;
let gestureEvt = null;        // 本帧刚出现的手势名（边沿触发），主循环末尾清除
let gestureMove = 0;          // -1 / 0 / 1，持续移动方向
let lastMainGesture = null;   // 边沿检测：手势变化时才触发一次
let camLastTime = -1;

async function initGestures() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  try {
    gestureStatus.textContent = "📷 正在请求摄像头权限…";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: "user" }, audio: false,
    });
    camVideo.srcObject = stream;
    await camVideo.play().catch(() => {});
    gestureStatus.textContent = "🧠 手势模型加载中…";
    const vision = await import("./puzzle/lib/tasks-vision/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks("./puzzle/lib/tasks-vision/wasm");
    let ok = false;
    for (const delegate of ["GPU", "CPU"]) { // 有的电脑不能用 GPU，退回 CPU
      try {
        recognizer = await vision.GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "./puzzle/gesture_recognizer.task", delegate },
          runningMode: "VIDEO",
          numHands: 1,
        });
        ok = true; break;
      } catch (e) { /* 换下一个 delegate */ }
    }
    if (!ok) throw new Error("GestureRecognizer 初始化失败");
    gestureReady = true;
    gestureStatus.textContent = "✋ 手势控制已就绪";
    setTimeout(() => { gestureStatus.style.opacity = 0; }, 4000);
  } catch (err) {
    console.warn("手势控制初始化失败：", err);
    gestureStatus.textContent = "⚠ 手势控制不可用，可用键盘 / 触屏游玩";
    camVideo.classList.add("hidden");
    setTimeout(() => { gestureStatus.style.opacity = 0; }, 6000);
  }
}

function updateGestures() {
  gestureMove = 0;
  if (!gestureReady || !recognizer) return;
  if (currentScene === levelScene && levelScene.puzzleOpen) return; // 摄像头让给星盘 iframe
  if (camVideo.readyState < 2 || camVideo.currentTime === camLastTime) return;
  camLastTime = camVideo.currentTime;
  let res;
  try { res = recognizer.recognizeForVideo(camVideo, performance.now()); }
  catch (e) { return; }
  const g = res.gestures && res.gestures[0] && res.gestures[0][0];
  const name = g && g.score >= 0.65 ? g.categoryName : null;
  if (name && name !== lastMainGesture &&
      (name === "Open_Palm" || name === "Pointing_Up" || name === "Thumb_Up")) {
    gestureEvt = name;
  }
  lastMainGesture = name;
  if (res.landmarks && res.landmarks[0]) {
    const x = 1 - res.landmarks[0][9].x; // 中指根，镜像到玩家视角
    if (x < 0.42) gestureMove = -1;
    else if (x > 0.58) gestureMove = 1;
  }
}

// C 键：切换摄像头小窗 / 状态显隐
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyC") {
    camVideo.classList.toggle("hidden");
    gestureStatus.classList.toggle("hidden");
  }
});

/* ---------- 缓动 ---------- */
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

/* ---------- 加法发光（复刻 PointLight2D：程序化径向渐变 + lighter 混合） ---------- */
const lightSpriteCache = {};
function lightSprite(color) {
  // 程序化生成径向渐变光晕：中心白热 → 彩色 → 边缘 alpha 严格为 0
  // （不用 circle 贴图：有损压缩会让边缘 alpha 非零，加色混合下显出矩形）
  if (lightSpriteCache[color]) return lightSpriteCache[color];
  const m = color.match(/[\d.]+/g).map(Number);
  const [r, g, b] = m;
  const c = document.createElement("canvas");
  c.width = c.height = 800;
  const g2 = c.getContext("2d");
  const rg = g2.createRadialGradient(400, 400, 0, 400, 400, 400);
  rg.addColorStop(0.00, `rgba(255,252,244,0.95)`);            // 白热核心
  rg.addColorStop(0.12, `rgba(${r},${g},${b},0.85)`);
  rg.addColorStop(0.35, `rgba(${r},${g},${b},0.42)`);
  rg.addColorStop(0.62, `rgba(${r},${g},${b},0.14)`);
  rg.addColorStop(0.85, `rgba(${r},${g},${b},0.03)`);
  rg.addColorStop(1.00, `rgba(${r},${g},${b},0)`);             // 边缘收敛到 0
  g2.fillStyle = rg;
  g2.fillRect(0, 0, 800, 800);
  lightSpriteCache[color] = c;
  return c;
}
function drawLight(x, y, rx, ry, color, energy) {
  const a = Math.min(0.95, Math.max(0, energy * 0.28));
  if (a <= 0.001) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = a;
  ctx.drawImage(lightSprite(color), x - rx, y - ry, rx * 2, ry * 2);
  ctx.restore();
}

/* ---------- UI 层切换 ---------- */
const layers = {
  menu: document.getElementById("menu-ui"),
  cg: document.getElementById("cg-ui"),
  dialogue: document.getElementById("dialogue-ui"),
};
function showLayer(name) {
  for (const k in layers) layers[k].classList.toggle("hidden", k !== name);
  if (!name) for (const k in layers) layers[k].classList.add("hidden");
}

/* =====================================================================
 * 场景一：开始菜单（opening.tscn / start_menu.gd）
 * ===================================================================== */
const menuScene = {
  bgm: BGM.menu,
  frame: 0, frameTimer: 0, playerTimer: 0,
  fade: 0, fading: false, embers: [],
  enter() {
    showLayer("menu");
    BGM.menu.volume = audioUnlocked ? 1 : 0;
    BGM.menu.play().catch(() => {});
    // 漂浮余烬（复刻 GPUParticles2D：spotlight 纹理，缓慢向右上方漂移）
    this.embers = [];
    for (let i = 0; i < 45; i++) this.embers.push(this.newEmber(true));
  },
  newEmber(anywhere) {
    return {
      x: Math.random() * VW,
      y: anywhere ? Math.random() * VH : VH + 30,
      vx: 6 + Math.random() * 10, vy: -(6 + Math.random() * 10),
      size: 32 * (0.5 + Math.random() * 0.4) * 2,
      alpha: 0.10 + Math.random() * 0.25,
      hue: Math.random(),
    };
  },
  update(dt) {
    this.frameTimer += dt;
    if (this.frameTimer >= 1 / 5) { this.frameTimer = 0; this.frame = (this.frame + 1) % 35; } // 5fps
    this.playerTimer += dt;
    for (let i = 0; i < this.embers.length; i++) {
      const p = this.embers[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y < -60 || p.x > VW + 60) this.embers[i] = this.newEmber(false);
    }
    // 🖐 张开手掌（或点击画面任意处）开始游戏
    if (gestureEvt === "Open_Palm" || clickPressed) this.startGame();
    if (this.fading) {
      this.fade = Math.min(1, this.fade + dt / 0.8);
      BGM.menu.volume = Math.max(0, 1 - this.fade);
      if (this.fade >= 1) switchScene(cgScene);
    }
  },
  startGame() {
    if (this.fading) return;
    this.fading = true;
    showLayer(null); // 隐藏提示行，进入过场
  },
  draw() {
    // 背景动画：1280×720 帧，缩放 0.9008×0.9125，中心 (576.5, 329.5)
    const im = IMG["seq" + this.frame];
    if (im) {
      const w = im.width * 0.9007813, h = im.height * 0.9125;
      ctx.drawImage(im, 576.5 - w / 2, 329.5 - h / 2, w, h);
    } else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, VW, VH); }

    // 标题图（微信图片，1296×735 原尺寸摆在该位置）
    if (IMG.title) ctx.drawImage(IMG.title, 569, -36);

    // 大角色 idle：idle2 整表 12 帧 6fps，位置 (452,384)，缩放 5.201×5.167
    if (IMG.idle) {
      const f = Math.floor(this.playerTimer * 6) % 12;
      const sx = (f % 4) * 128, sy = Math.floor(f / 4) * 128;
      const w = 128 * 5.20111, h = 128 * 5.1671753;
      ctx.drawImage(IMG.idle, sx, sy, 128, 128, 452 - w / 2, 384 - h / 2, w, h);
    }

    // 余烬
    ctx.save();
    for (const p of this.embers) {
      ctx.globalAlpha = p.alpha;
      if (IMG.ember) ctx.drawImage(IMG.ember, p.x, p.y, p.size, p.size);
    }
    ctx.restore();

    // 提灯暖光（energy 6.3，附加混合）
    drawLight(585.5, 448.45, 218, 182, "rgb(247,150,68)", 6.3);

    if (this.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${this.fade})`; ctx.fillRect(0, 0, VW, VH); }
  },
};

/* =====================================================================
 * 场景二：开场 CG（opening_cg.tscn / opening_cg.gd）
 * 8 张 CG 交叉溶解；图 3 竖向缓动滚动；字幕 + 点击推进；播完进第一关
 * ===================================================================== */
const CG_DATA = [
  { img: "cg1", motion: "static",   subtitle: "灯芯镇是一座藏在山间的小镇，靠着世代相传的「灯魔法」维生。" },
  { img: "cg2", motion: "static",   subtitle: "这里的每一盏灯里，都封着一小段记忆。守灯人收集这些微光，汇进镇心的长明灯塔，让小镇永远明亮。" },
  { img: "cg3", motion: "pan_down", subtitle: "我叫烬，是镇上的守灯人。" },
  { img: "cg4", motion: "static",   subtitle: "姐姐炘和我是镇上最后的守灯人，她给了我人生中的第一盏提灯，而她也是我生命中唯一的灯光。" },
  { img: "cg5", motion: "static",   subtitle: "可是三个月前，镇上的灯火开始一盏接一盏地熄灭。灯灭的地方，时间慢了下来，最后停格在黄昏。" },
  { img: "cg6", motion: "static",   subtitle: "镇民们陆续搬走了，只有我们姐妹留了下来。一周前，姐姐独自去了长明灯塔，再没有回来。" },
  { img: "cg7", motion: "static",   subtitle: "今天，我在她的工作台上发现了那盏旧提灯。灯旁边是她的留言：「只要灯亮着，我就找得到回来的路。」" },
  { img: "cg8", motion: "static",   subtitle: "我决定带着灯光，重新点亮小镇，找到通往灯塔的路。", hint: "—— 🖐 张开手掌开始游戏 ——" },
];
const DISSOLVE_TIME = 1.6, PAN_TIME = 10.0;

const cgScene = {
  bgm: BGM.cg,
  index: 0, transitioning: false, dissolve: 0,
  fadeIn: 0, fadeOut: 0, panT: 0,
  subtitleEl: null, hintEl: null,
  enter() {
    showLayer("cg");
    this.subtitleEl = document.getElementById("cg-subtitle");
    this.hintEl = document.getElementById("cg-hint");
    this.index = 0; this.transitioning = false; this.dissolve = 0;
    this.fadeIn = 0; this.fadeOut = 0; this.panT = 0;
    BGM.cg.currentTime = 0;
    BGM.cg.volume = 0;
    BGM.cg.play().catch(() => {});
    if (audioUnlocked) fadeVolume(BGM.cg, 1, 1.2);
    this.applyText();
  },
  applyText() {
    const d = CG_DATA[this.index];
    this.subtitleEl.textContent = d.subtitle;
    this.hintEl.textContent = d.hint || "🖐 张开手掌继续...";
    this.hintEl.classList.toggle("gold", this.index === CG_DATA.length - 1);
  },
  next() {
    if (this.transitioning || this.fadeOut > 0) return;
    if (this.index >= CG_DATA.length - 1) { // 收场：淡出到黑，进第一关
      this.fadeOut = 0.0001;
      fadeVolume(BGM.cg, 0, 1.2);
      return;
    }
    this.transitioning = true;
    this.dissolve = 0;
    this.subtitleEl.style.opacity = 0;
  },
  update(dt) {
    if (this.fadeIn < 1) this.fadeIn = Math.min(1, this.fadeIn + dt / 1.2);
    if (this.fadeOut > 0) {
      this.fadeOut = Math.min(1, this.fadeOut + dt / 1.2);
      if (this.fadeOut >= 1) { BGM.cg.pause(); switchScene(levelScene); return; }
    }
    if (this.transitioning) {
      this.dissolve = Math.min(1, this.dissolve + dt / DISSOLVE_TIME);
      if (this.dissolve >= 1) {
        this.index++;
        this.transitioning = false; this.dissolve = 0; this.panT = 0;
        this.applyText();
        this.subtitleEl.style.opacity = 1;
      }
    } else if (CG_DATA[this.index].motion === "pan_down") {
      this.panT = Math.min(PAN_TIME, this.panT + dt);
    }
    if (clickPressed || actionPressed("light") || pressed["Space"] || pressed["Enter"] || gestureEvt === "Open_Palm") this.next();
  },
  drawCG(im, motion, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#000"; // 黑色衬底（上下层均不透明，溶解不透底）
    if (motion === "pan_down" && im) {
      const h = im.height * (VW / im.width);
      const overflow = Math.max(0, h - VH);
      const y = -overflow * easeInOutSine(this.panT / PAN_TIME);
      ctx.imageSmoothingEnabled = true; // 竖向滚动用线性过滤，避免亚像素抖动
      ctx.fillRect(0, 0, VW, VH);
      ctx.drawImage(im, 0, y, VW, h);
      ctx.imageSmoothingEnabled = false;
    } else {
      ctx.fillRect(0, 0, VW, VH);
      if (im) {
        const s = Math.min(VW / im.width, VH / im.height); // contain 居中
        const w = im.width * s, h = im.height * s;
        ctx.drawImage(im, (VW - w) / 2, (VH - h) / 2, w, h);
      }
    }
    ctx.globalAlpha = 1;
  },
  draw() {
    const cur = CG_DATA[this.index];
    if (this.transitioning) {
      this.drawCG(IMG[cur.img], cur.motion, 1);
      const nxt = CG_DATA[this.index + 1];
      this.drawCG(IMG[nxt.img], nxt.motion, easeInOutSine(this.dissolve));
    } else {
      this.drawCG(IMG[cur.img], cur.motion, 1);
    }
    const dark = Math.max(1 - this.fadeIn, this.fadeOut);
    if (dark > 0) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, VW, VH); }
  },
};

/* =====================================================================
 * 场景三：第一关（level_1.tscn / player.gd / light.gd）
 * 视差背景 4 层（第 4 层置顶且不受灯光影响）、瓦片碰撞、提灯跟随翻转、
 * 路灯交互点灯：光晕爆发 → 灯光渐亮 → 烬的剧情对话
 * ===================================================================== */
const GRAVITY = 980, SPEED = 300, JUMP_VELOCITY = -400;
const TILE = 16;
const CAM = { minX: VW / 2, maxX: 2300 - VW / 2, minY: VH / 2, maxY: 650 - VH / 2, smooth: 5 };

// 瓦片碰撞表
const solidSet = new Set();
for (const t of window.TILE_DATA.tiles) if (t.solid) solidSet.add(t.x + "," + t.y);
function solidAt(cx, cy) { return solidSet.has(cx + "," + cy); }

const DIALOGUE_LINES = [
  "亮了……这盏灯，还认得回家的路。",
  "镇子上最后一点火光，就由我守着吧。",
];

const levelScene = {
  bgm: BGM.level,
  bgmTarget: 0.7,
  // 玩家状态（对应 player.gd）
  px: 136, py: 495, vx: 0, vy: 0, onFloor: false, faceLeft: false,
  animTime: 0, anim: "idle",
  camX: 576, camY: 326,
  // 路灯状态（对应 light.gd）
  lampLit: false, lampEnergy: 0, lampX: 763, lampY: 461,
  // 手势解密小游戏
  puzzleOpen: false,
  // 特效
  burst: null, sparks: [],
  // 对话
  dlg: { open: false, line: 0, chars: 0, typing: false, waitInput: false },

  enter() {
    showLayer(null);
    // 进入游戏画面：循环播放第一版 BGM（轻松日常）
    BGM.level.currentTime = 0;
    BGM.level.volume = audioUnlocked ? this.bgmTarget : 0;
    BGM.level.play().catch(() => {});
    SFX.steps.pause(); SFX.steps.currentTime = 0;
    this.px = 136; this.py = 495; this.vx = 0; this.vy = 0;
    this.faceLeft = false; this.anim = "idle"; this.animTime = 0;
    this.camX = Math.min(Math.max(this.px, CAM.minX), CAM.maxX);
    this.camY = Math.min(Math.max(this.py, CAM.minY), CAM.maxY);
    this.lampLit = false; this.lampEnergy = 0;
    this.puzzleOpen = false;
    puzzleFrame.classList.add("hidden");
    this.burst = null; this.sparks = [];
    this.dlg.open = false;
    // 所有设备：进入关卡时短暂显示操作提示（摄像头手势为主，键盘 / 触屏兜底）
    const ctrlLine = isTouchDevice
      ? "触屏：按住左 / 右半屏移动 · 上滑跳跃 · 靠近路灯点「点灯」"
      : "键盘：A / D 或 ← / → 移动 · 空格 / W 跳跃 · E 点灯";
    touchHint.innerHTML = gestureReady
      ? `🖐 手放画面左 / 右侧移动 · ☝️ 食指向上跳跃 · 👍 拇指向上点灯<br>${ctrlLine}`
      : ctrlLine;
    touchHint.classList.remove("hidden");
    touchHint.style.opacity = 1;
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => { touchHint.style.opacity = 0; }, 8000);
  },

  /* ----- 点灯（light.gd: light_up） ----- */
  lightUp() {
    this.lampLit = true;
    // 光晕爆发特效（light_burst.gd）
    this.burst = { x: this.lampX + 24, y: this.lampY - 23.4, t: 0, dur: 1.2 };
    this.sparks = [];
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, v = 90 + Math.random() * 100;
      this.sparks.push({
        x: this.burst.x, y: this.burst.y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        damp: 40 + Math.random() * 40, life: 0.9, t: 0,
        size: 6 + Math.random() * 10,
      });
    }
    this.openDialogue();
  },

  /* ----- 剧情对话（lamp_balloon.gd + lamp.dialogue） ----- */
  openDialogue() {
    this.dlg = { open: true, line: 0, chars: 0, typing: true, waitInput: false };
    showLayer("dialogue");
    const nameEl = document.getElementById("dlg-name");
    const textEl = document.getElementById("dlg-text");
    // lamp_balloon 布局：文字区跟在立绘右侧（立绘高 82%，宽按比例）
    const ph = VH * 0.82, pw = ph * (1242 / 1600);
    const textLeft = Math.min(Math.max(VW * 0.04 + pw + VW * 0.02, VW * 0.28), VW * 0.45);
    nameEl.style.left = textLeft + "px";
    textEl.style.left = textLeft + "px";
    textEl.style.width = (VW - textLeft - VW * 0.08) + "px";
    textEl.textContent = "";
    document.getElementById("dlg-next").style.visibility = "hidden";
  },
  advanceDialogue() {
    const d = this.dlg;
    if (!d.open) return;
    if (d.typing) { d.chars = DIALOGUE_LINES[d.line].length; d.typing = false; return; } // 先补完
    if (!d.waitInput) return;
    d.line++;
    if (d.line >= DIALOGUE_LINES.length) { d.open = false; showLayer(null); return; }
    d.chars = 0; d.typing = true; d.waitInput = false;
    document.getElementById("dlg-next").style.visibility = "hidden";
  },

  update(dt) {
    if (this.puzzleOpen) return; // 解密小游戏进行中：游戏世界冻结
    /* --- 玩家物理（player.gd） --- */
    const frozen = this.dlg.open;
    let dir = 0;
    // 键盘 + 触屏 + 摄像头手势合并（手掌在画面左 / 右侧 = 方向）
    if (!frozen) dir = (actionDown("right") ? 1 : 0) - (actionDown("left") ? 1 : 0) + touchCtl.move + gestureMove;
    dir = Math.max(-1, Math.min(1, dir));
    if (dir !== 0) {
      this.vx = dir * SPEED;
      this.faceLeft = dir < 0; // 翻转贴图，点光源随之换侧
    } else {
      this.vx = Math.abs(this.vx) < SPEED * dt * 60 ? 0 : this.vx - Math.sign(this.vx) * SPEED * dt * 60;
      if (frozen) this.vx = 0;
    }
    this.vy += GRAVITY * dt;
    if (!frozen && this.onFloor && (actionPressed("jump") || touchCtl.jump || gestureEvt === "Pointing_Up")) this.vy = JUMP_VELOCITY; // 空格/↑、上滑或 ☝️ 食指向上

    // 动画：移动 walk / 停下 idle
    const want = dir !== 0 ? "walk" : "idle";
    if (want !== this.anim) { this.anim = want; this.animTime = 0; }
    this.animTime += dt;

    // X 轴移动 + 瓦片碰撞（胶囊 ≈ 半宽 20 半高 45 的 AABB）
    const HW = 20, HH = 45;
    let nx = this.px + this.vx * dt;
    let cx = nx - 1, cy = this.py + 1;
    if (this.vx !== 0) {
      const edge = this.vx > 0 ? cx + HW : cx - HW;
      const tx = Math.floor(edge / TILE);
      for (let ty = Math.floor((cy - HH + 1) / TILE); ty <= Math.floor((cy + HH - 1) / TILE); ty++) {
        if (solidAt(tx, ty)) {
          nx = this.vx > 0 ? tx * TILE - HW + 1 : (tx + 1) * TILE + HW + 1;
          this.vx = 0; break;
        }
      }
    }
    nx = Math.min(Math.max(nx, HW), 2302 - HW); // 世界边界（左右空气墙）
    this.px = nx;

    // Y 轴移动 + 瓦片碰撞
    let ny = this.py + this.vy * dt;
    cx = this.px - 1; cy = ny + 1;
    this.onFloor = false;
    if (this.vy !== 0) {
      const edge = this.vy > 0 ? cy + HH : cy - HH;
      const ty = Math.floor(edge / TILE);
      for (let tx = Math.floor((cx - HW + 1) / TILE); tx <= Math.floor((cx + HW - 1) / TILE); tx++) {
        if (solidAt(tx, ty)) {
          ny = this.vy > 0 ? ty * TILE - HH - 1 : (ty + 1) * TILE + HH - 1;
          if (this.vy > 0) this.onFloor = true;
          this.vy = 0; break;
        }
      }
    }
    this.py = ny;
    if (this.py > 900) { this.px = 136; this.py = 495; this.vx = this.vy = 0; } // 兜底重生

    /* --- 脚步声：在地面行走时循环播放，停下 / 离地 / 对话时即停 --- */
    const walking = dir !== 0 && this.onFloor && !frozen;
    if (walking && SFX.steps.paused && audioUnlocked) SFX.steps.play().catch(() => {});
    if (!walking && !SFX.steps.paused) SFX.steps.pause();

    /* --- 相机跟随（Camera2D：平滑 + 边界） --- */
    const k = 1 - Math.exp(-CAM.smooth * dt);
    this.camX += (this.px - this.camX) * k;
    this.camY += (this.py - this.camY) * k;
    this.camX = Math.min(Math.max(this.camX, CAM.minX), CAM.maxX);
    this.camY = Math.min(Math.max(this.camY, CAM.minY), CAM.maxY);

    /* --- 路灯交互（light.gd：E 键 / 「点灯」按钮 → 先进入手势解密小游戏） --- */
    const nearLamp = Math.hypot(this.px - this.lampX, this.py - this.lampY) < 120;
    // E 键或 👍 拇指向上 → 打开星盘解密
    if (!this.lampLit && !this.dlg.open && (actionPressed("light") || gestureEvt === "Thumb_Up") && nearLamp) openPuzzle();
    // 触屏设备：靠近路灯时显示右下角的「点灯」按钮
    lightButton.classList.toggle("hidden",
      !(isTouchDevice && nearLamp && !this.lampLit && !this.dlg.open));
    // 灯光能量缓慢升至目标值（3 秒，正弦缓动）
    if (this.lampLit && this.lampEnergy < 1.95) {
      this.lampEnergy = Math.min(1.95, this.lampEnergy + dt * (1.95 / 3));
    }

    /* --- 特效推进 --- */
    if (this.burst) { this.burst.t += dt; if (this.burst.t >= this.burst.dur) this.burst = null; }
    for (const s of this.sparks) {
      s.t += dt;
      const f = Math.exp(-s.damp * s.t / 100);
      s.x += s.vx * f * dt; s.y += s.vy * f * dt;
    }
    this.sparks = this.sparks.filter((s) => s.t < s.life);

    /* --- 对话打字机 --- */
    const d = this.dlg;
    if (d.open) {
      if (d.typing) {
        d.chars = Math.min(DIALOGUE_LINES[d.line].length, d.chars + dt * 24);
        if (d.chars >= DIALOGUE_LINES[d.line].length) {
          d.typing = false; d.waitInput = true;
          document.getElementById("dlg-next").style.visibility = "visible";
        }
      }
      document.getElementById("dlg-text").textContent =
        DIALOGUE_LINES[d.line].slice(0, Math.floor(d.chars));
      if (clickPressed || actionPressed("light") || pressed["Enter"] || gestureEvt === "Open_Palm") this.advanceDialogue();
    }
  },

  /* ----- 视差层绘制（ParallaxBackground：mirror 1150，垂直 1:1） ----- */
  drawParallax(im, m, childY, scrollX, scrollY) {
    if (!im) return;
    const w = im.width * 0.915873, h = im.height * 0.93626064;
    let start = -(scrollX * m) % 1150;
    if (start > 0) start -= 1150;
    const y = childY - scrollY;
    for (let x = start; x < VW; x += 1150) ctx.drawImage(im, x, y, w, h);
  },

  draw() {
    const scrollX = this.camX - VW / 2, scrollY = this.camY - VH / 2;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, VW, VH);

    // 视差背景后三层（layer = -100，画在最底）
    this.drawParallax(IMG.bg0, 0.2, 0, scrollX, scrollY);
    this.drawParallax(IMG.bg2, 0.5, 11, scrollX, scrollY);
    this.drawParallax(IMG.bg4, 0.8, 18, scrollX, scrollY);

    const wx = (x) => x - scrollX, wy = (y) => y - scrollY;

    // 点灯提示（场景树顺序：Label 在瓦片之前；👍 手势为主，按键 / 按钮兜底）
    if (!this.lampLit) {
      ctx.fillStyle = "#fff";
      ctx.font = "32px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(isTouchDevice ? "👍 拇指向上点灯（或点右下角按钮）" : "👍 拇指向上点灯（或按 E）", wx(418), wy(498));
    }

    // 玩家（场景树顺序：player 在 TileMap 之前）
    const sheet = this.anim === "walk" ? IMG.walk : IMG.idle;
    if (sheet) {
      const fps = this.anim === "walk" ? 7 : 8;
      const frames = this.anim === "walk" ? 4 : 6;
      const f = Math.floor(this.animTime * fps) % frames;
      const sx = (f % 4) * 128, sy = Math.floor(f / 4) * 128;
      const w = 128 * 2.2109375, h = 128 * 2.3242188;
      const dx = wx(this.px - 1), dy = wy(this.py + 2);
      ctx.save();
      ctx.translate(dx, dy);
      if (this.faceLeft) ctx.scale(-1, 1); // 面向左：水平翻转
      ctx.drawImage(sheet, sx, sy, 128, 128, -w / 2, -h / 2, w, h);
      ctx.restore();
    }

    // 瓦片地图（TileMap 位置 (0,-1)，最近邻）
    if (IMG.tileset) {
      const x0 = Math.floor(scrollX / TILE) - 1, x1 = Math.floor((scrollX + VW) / TILE) + 1;
      const y0 = Math.floor(scrollY / TILE) - 1, y1 = Math.floor((scrollY + VH) / TILE) + 1;
      for (const t of window.TILE_DATA.tiles) {
        if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
        ctx.drawImage(IMG.tileset, t.tx * TILE, t.ty * TILE, TILE, TILE,
          Math.round(wx(t.x * TILE)), Math.round(wy(t.y * TILE - 1)), TILE, TILE);
      }
    }

    // 路灯光杆（light.tscn：128 帧，缩放 2.212×2.245，中心 (762,464)）
    if (IMG.lamp) {
      const w = 128 * 2.211914, h = 128 * 2.2446833;
      ctx.drawImage(IMG.lamp, wx(this.lampX - 1) - w / 2, wy(this.lampY + 3) - h / 2, w, h);
    }

    /* --- 点光源（PointLight2D，加法混合） --- */
    // 手上提灯：光源绑定在提灯发光核心（帧内 ≈(82,74) → 角色坐标 ±39, 25），随面向换侧
    const lampOffX = this.faceLeft ? -39 : 39;
    drawLight(wx(this.px + lampOffX), wy(this.py + 25), 100, 88, "rgb(255,196,110)", 9.25);
    // 路灯光：点灯后能量 0 → 1.95
    if (this.lampEnergy > 0)
      drawLight(wx(this.lampX + 24), wy(this.lampY - 23.4), 156, 140.6, "rgb(189,174,54)", this.lampEnergy);

    // 光晕爆发（light_burst：halo 扩散淡出 + 金色火花）
    if (this.burst) {
      const t = this.burst.t / this.burst.dur;
      const r = 12 + (220 - 12) * easeOutQuart(t);
      const a = 0.55 * (1 - easeInOutSine(t));
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = a;
      ctx.drawImage(lightSprite("rgb(255,242,153)"), wx(this.burst.x) - r, wy(this.burst.y) - r, r * 2, r * 2);
      ctx.restore();
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const s of this.sparks) {
      ctx.globalAlpha = Math.max(0, 1 - s.t / s.life);
      ctx.fillStyle = "rgb(255,224,115)";
      ctx.beginPath();
      ctx.arc(wx(s.x), wy(s.y), s.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },
};

/* =====================================================================
 * 手势解密小游戏（iframe 覆盖层，puzzle/puzzle.html）
 * 按 E 打开 → 完成一个星座的解密 → 收到 postMessage → 退出 → 灯亮
 * ===================================================================== */
const puzzleFrame = document.getElementById("puzzle-frame");
const lightButton = document.getElementById("btn-light");
const touchHint = document.getElementById("touch-hint");

// 触屏「点灯」按钮：与 E 键等效，进入手势解密
lightButton.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!levelScene.lampLit && !levelScene.dlg.open && !levelScene.puzzleOpen) openPuzzle();
});

function openPuzzle() {
  levelScene.puzzleOpen = true;
  SFX.steps.pause(); // 解密期间世界冻结，脚步声停
  lightButton.classList.add("hidden");
  puzzleFrame.src = "puzzle/puzzle.html?t=" + Date.now(); // 每次都重新洗一盘
  puzzleFrame.classList.remove("hidden");
  puzzleFrame.onload = () => {
    if (puzzleFrame.contentWindow) puzzleFrame.contentWindow.focus();
  };
}

function closePuzzle() {
  levelScene.puzzleOpen = false;
  puzzleFrame.classList.add("hidden");
  puzzleFrame.src = "about:blank"; // 释放摄像头
}

// 解密成功：退出小游戏，灯才会亮起
window.addEventListener("message", (e) => {
  if (e.data === "puzzle-solved" && levelScene.puzzleOpen) {
    closePuzzle();
    levelScene.lightUp();
  }
});

// ESC：转发给小游戏（打开 / 关闭手势教程页）
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && levelScene.puzzleOpen) {
    e.preventDefault();
    if (puzzleFrame.contentWindow) puzzleFrame.contentWindow.postMessage("esc", "*");
  }
});

/* =====================================================================
 * 场景管理 + 主循环
 * ===================================================================== */
let currentScene = null;
function switchScene(s) {
  currentScene = s;
  s.enter();
}

let lastT = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
  lastT = now;
  updateGestures(); // 摄像头手势采样（在场景更新前，产出 gestureEvt / gestureMove）
  if (currentScene) {
    currentScene.update(dt);
    currentScene.draw();
  }
  // 清掉本帧的"刚按下"状态
  for (const k in pressed) pressed[k] = false;
  clickPressed = false;
  touchCtl.jump = false;
  gestureEvt = null;
  requestAnimationFrame(loop);
}

// 加载画面 → 主菜单（手势识别与图片资源并行加载）
initGestures();
loadImages().then(() => {
  switchScene(menuScene);
  requestAnimationFrame(loop);
});

// 加载期间的简易进度
(function loadingScreen() {
  if (currentScene) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = "rgba(255,255,255,.6)";
  ctx.font = "20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`灯芯镇最后的灯 · 加载中 ${loaded}/${loadTotal}`, VW / 2, VH / 2);
  requestAnimationFrame(loadingScreen);
})();
