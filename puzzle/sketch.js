// =====================================================================
//  《灯芯镇最后的灯 · 星盘解密》— 嵌入手势解密小游戏
//  改编自《梦幻星空 · 星座法阵》：
//    · 去掉主菜单，打开即进入星空（摄像头授权后直接开始）
//    · 每局只解一关：🖐 召唤星盘 → 拧动对齐 → 🤏 捏合显现本关星座
//    · 星座完全显现后弹出烬的通关独白（🖐 张开手掌逐句推进），
//      说完最后一句才向主页面发 postMessage('puzzle-solved')，退出并点灯
//    · ESC 打开 / 关闭手势教程页（也可由主页面转发 ESC）
//  PART A 是手势识别引擎，不要修改。
// =====================================================================


// ---------------------------------------------------------------------
//  PART A — 手势识别引擎
// ---------------------------------------------------------------------
const MP_VERSION = "0.10.21";
// MediaPipe 运行时：优先项目内置的本地文件（离线可用），失败再试 CDN
const MP_SOURCES = [
  { lib: "./lib/tasks-vision/vision_bundle.js", wasm: "./lib/tasks-vision/wasm" },
  { lib: `https://registry.npmmirror.com/@mediapipe/tasks-vision/${MP_VERSION}/files/vision_bundle.mjs`,
    wasm: `https://registry.npmmirror.com/@mediapipe/tasks-vision/${MP_VERSION}/files/wasm` },
  { lib: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`,
    wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm` },
];
// 手势模型：项目文件夹里的 gesture_recognizer.task，兜底再从 Google 下载
const MODEL_URLS = [
  "gesture_recognizer.task",
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
];

// 模型认识的 8 种手势
const GESTURE_NAMES = {
  None: "无",
  Closed_Fist: "握拳 ✊",
  Open_Palm: "张开手掌 🖐",
  Pointing_Up: "食指向上 ☝️",
  Thumb_Down: "拇指向下 👎",
  Thumb_Up: "拇指向上 👍",
  Victory: "剪刀手 ✌️",
  ILoveYou: "我爱你 🤟",
};

let video;                 // 摄像头画面（p5 capture）
let recognizer = null;     // MediaPipe 手势识别模型
let hands = [];            // 每帧看到的所有手：{gesture, score, points(21 点画布坐标, 已镜像), side}
let lastVideoTime = -1;
let started = false;
let showCamera = false;

async function loadGestureRecognizer() {
  setStatus("正在加载手势模型…");
  for (const src of MP_SOURCES) {
    let vision, fileset;
    try {
      vision = await import(src.lib);
      fileset = await vision.FilesetResolver.forVisionTasks(src.wasm);
    } catch (e) {
      continue; // 这个来源打不开，换下一个
    }
    for (const model of MODEL_URLS) {
      for (const delegate of ["GPU", "CPU"]) { // 有的电脑不能用 GPU，就退回 CPU
        try {
          recognizer = await vision.GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: model, delegate },
            runningMode: "VIDEO",
            numHands: 2,
          });
          return; // 成功！
        } catch (e) {
          // 失败就试下一个
        }
      }
    }
  }
  setStatus("⚠️ 手势模型加载失败：请确认通过本地服务器（localhost）打开游戏，而不是直接双击 html");
}

// 每一帧调用一次：向 MediaPipe 要最新的手势和关键点
let cameraOk = null;
function updateHands() {
  if (!recognizer || !video) return;

  const ok = video.elt.readyState >= 2;
  if (ok !== cameraOk) {
    cameraOk = ok;
    setStatus(ok ? "张开手掌 🖐 召唤星盘（按 ESC 查看手势教程）"
                 : "正在等待摄像头…请点击「允许」浏览器使用摄像头");
  }
  if (!ok) return;

  if (video.elt.currentTime === lastVideoTime) return;
  lastVideoTime = video.elt.currentTime;

  const result = recognizer.recognizeForVideo(video.elt, performance.now());
  const sides = result.handedness || result.handednesses || [];
  hands = result.landmarks.map((lm, i) => {
    const best = (result.gestures[i] && result.gestures[i][0]) || { categoryName: "None", score: 0 };
    return {
      gesture: best.categoryName || "None",
      score: best.score,
      side: sides[i] && sides[i][0] ? sides[i][0].categoryName : "",
      points: lm.map((p) => ({ x: (1 - p.x) * width, y: p.y * height, z: p.z })),
    };
  });
}

// 在每只手的手腕旁边写出识别到的手势和把握程度（按 I 开关）
function drawGestureInfo() {
  push();
  textSize(16);
  textAlign(CENTER, TOP);
  for (const hand of hands) {
    const w = hand.points[0];
    const y = min(w.y + 14, height - 70);
    const label = `${GESTURE_NAMES[hand.gesture] || hand.gesture}  ${round(hand.score * 100)}%`;
    noStroke();
    fill(0, 120);
    rect(w.x - textWidth(label) / 2 - 8, y, textWidth(label) + 16, 26, 6);
    fill(255);
    text(label, w.x, y + 4);
  }
  pop();
}

function drawCamera() {
  push();
  translate(width, 0);
  scale(-1, 1); // 镜像，像照镜子一样
  tint(255, 70);
  image(video, 0, 0, width, height);
  pop();
}

function setStatus(msg) {
  select("#status").html(msg);
}


// ---------------------------------------------------------------------
//  PART B — 星盘解密（单关卡版）
// ---------------------------------------------------------------------

const SKY_DEEP = "#05122e";
const MAX_STARS = 300;

let stars = [];
let magicCircle;
let zodiacs = [];
let current = 0;       // 本局要解的星座（每局随机一个）
let summoned = false;  // 星座是否已被捏合召唤
let exitSent = false;  // 是否已通知主页面（只发一次）
let exitAt = 0;        // 星座完全显现的时刻（帧数），稍后退出
let lastGesture = {};
let lastPinch = {};
let showInfo = false;
let dlgPortraitImg = null; // 通关对话立绘（preload 里加载）

// ---------- 通关对话（星座汇聚后弹出，🖐 张开手掌逐句推进，说完最后一句才返回场景） ----------
const PUZZLE_DIALOGUE = [
  "这下应该就好了",
  "亮了……这盏灯，还认得回家的路。",
  "镇子上最后一点火光，就由我守着吧。",
];
let dlgOpen = false;
let dlgLine = 0;

const ZODIAC_GLYPHS = ["♈︎", "♉︎", "♊︎", "♋︎", "♌︎", "♍︎", "♎︎", "♏︎", "♐︎", "♑︎", "♒︎", "♓︎"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

// ---------- 星空视差背景 ----------
const BG_W = 1920, BG_H = 1080;
const bgImg = {};
const BG_LAYERS = [
  { img: "sky",   depth: 0,    items: [[960, 540, 1.03, 1920, 1080]] },
  { img: "glow2", depth: 0,    blend: "screen", alpha: 200, items: [[960, 540, 1.03, 1920, 1080]] },
  { img: "lut",   depth: 0,    items: [[960, 877.52, 1.03, 1920, 626]] },
  { img: "land",  depth: 0.07, items: [[960, 976.76, 1.03, 1920, 225]] },
  { img: "f1",    depth: 0.10, items: [[974.52, 525.48, 1.03, 687, 762]] },
  { img: "f9",    depth: 0.10, items: [[1325.08, 716.78, 1.03, 46, 52]] },
  { img: "f13",   depth: 0.10, items: [[1458.06, 322.38, 1.03, 44, 45]] },
  { img: "f7",    depth: 0.15, items: [[427.01, 736.33, 1.03, 50, 34]] },
  { img: "f10",   depth: 0.20, items: [[1421.74, 807.04, 1.03, 72, 38]] },
  { img: "f7",    depth: 0.22, items: [[180, 180, 1.8, 50, 34]] },
  { img: "f10",   depth: 0.27, items: [[320, 640, 1.6, 72, 38]] },
  { img: "f9",    depth: 0.30, items: [[1620, 760, 2.2, 46, 52]] },
  { img: "leak",  depth: 0.45, blend: "screen", alpha: 150, items: [[947.63, 780.66, 1.5, 1246, 720]] },
  { img: "leak",  depth: 0.75, blend: "screen", alpha: 110, items: [[882.58, 750.76, 1.6, 1246, 720]] },
];

function preload() {
  bgImg.sky = loadImage("bg/sky.webp");
  bgImg.glow2 = loadImage("bg/glow2.webp");
  bgImg.lut = loadImage("bg/lut.webp");
  bgImg.land = loadImage("bg/land.webp");
  bgImg.f1 = loadImage("bg/f1.webp");
  bgImg.f7 = loadImage("bg/f7.webp");
  bgImg.f9 = loadImage("bg/f9.webp");
  bgImg.f10 = loadImage("bg/f10.webp");
  bgImg.f13 = loadImage("bg/f13.webp");
  bgImg.leak = loadImage("bg/leak.webp");
  dlgPortraitImg = loadImage("../assets/portrait/jin_calm.webp"); // 通关对话立绘：烬·平静闭眼
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  magicCircle = { x: width / 2, y: height / 2, R: min(width, height) * 0.32, rot: 0, open: false };
  current = floor(random(12)); // 每局随机一个星座，只解这一关
  initStarDisk();
  initStars();
  initBokehs();
  layoutConstellations();
  // 没有主菜单：直接进入星空（浏览器会弹出摄像头授权）
  startExperience();
}

function initStars() {
  stars = [];
  const n = min(width, height) < 600 ? 170 : 270;
  for (let i = 0; i < n; i++) stars.push(newStar(random(width), random(height), random(1.5, 4.5)));
}

const STAR_TINTS = [
  [210, 225, 255], [210, 225, 255], [210, 225, 255],
  [190, 215, 255], [190, 215, 255],
  [150, 215, 255],
  [140, 235, 225],
  [180, 170, 255],
  [255, 240, 215],
];

function newStar(x, y, r) {
  return {
    x, y, px: x, py: y, homeX: x, homeY: y,
    r, phase: random(TWO_PI), seed: random(1000),
    speed: random(0.5, 1.3),
    tint: random(STAR_TINTS),
    tx: 0, ty: 0, hasTarget: false,
  };
}

function layoutConstellations() {
  zodiacs = CONSTELLATIONS.map((c) => ({
    name: c.name,
    latin: c.latin,
    raw: c.nodes,
    links: c.links,
    nodes: [],
    alpha: 0,
    phase: random(TWO_PI),
  }));
  const fit = min(width, height) * 0.62;
  const cx = width / 2;
  const cy = height / 2;
  for (const z of zodiacs) {
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const n of z.raw) {
      minX = min(minX, n[0]);
      maxX = max(maxX, n[0]);
      minY = min(minY, n[1]);
      maxY = max(maxY, n[1]);
    }
    const s = fit / max(maxX - minX, maxY - minY);
    z.nodes = z.raw.map((n) => ({
      x: cx + (n[0] - (minX + maxX) / 2) * s,
      y: cy + (n[1] - (minY + maxY) / 2) * s,
    }));
  }
}

function startExperience() {
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.elt.setAttribute("playsinline", "");
  video.elt.setAttribute("muted", "");
  video.hide();
  started = true;
  setStatus("正在加载手势模型…");
  loadGestureRecognizer();
}

// ---------- 教程页（ESC） ----------
let tutorialOpen = false;
function toggleTutorial() {
  tutorialOpen = !tutorialOpen;
  const el = document.getElementById("tutorial");
  if (el) el.classList.toggle("hidden", !tutorialOpen);
}
window.addEventListener("message", (e) => {
  if (e.data === "esc") toggleTutorial(); // 主页面转发来的 ESC
});
document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("tutorial");
  if (el) el.addEventListener("click", () => { if (tutorialOpen) toggleTutorial(); });
});

// ---------- 🤏 捏合检测：拇指尖(4) 与 食指尖(8) 距离够近 ----------
function handPinching(hand) {
  const thumb = hand.points[4], index = hand.points[8];
  const wrist = hand.points[0], midMcp = hand.points[9];
  const handSize = dist(wrist.x, wrist.y, midMcp.x, midMcp.y);
  if (handSize < 1) return false;
  return dist(thumb.x, thumb.y, index.x, index.y) < handSize * 0.35;
}

function onPinch(hand) {
  // 星盘对齐后捏合：显现本关星座
  if (magicCircle.open && magicCircle.solved && !summoned) {
    summonConstellation();
  } else if (!summoned) {
    setStatus(magicCircle.open
      ? `先拧动星盘，让外圈与中圈的「${zodiacs[current].name}」对齐 ✨`
      : "先张开手掌 🖐 召唤星盘");
  }
}

function draw() {
  // 1. 手势：同一个手势保持不动，只触发一次；捏合同理（边沿触发）
  if (started && !tutorialOpen) {
    updateHands();
    for (const hand of hands) {
      const g = hand.score >= 0.6 ? hand.gesture : "None";
      if (dlgOpen) {
        // 对话中：🖐 张开手掌 = 继续下一句，其余手势不触发游戏行为
        if (g === "Open_Palm" && g !== lastGesture[hand.side]) advanceDlg();
      } else if (g !== "None" && g !== lastGesture[hand.side]) onGesture(g, hand);
      if (g !== "None" || lastGesture[hand.side] !== undefined) lastGesture[hand.side] = g;

      const pinch = handPinching(hand);
      if (!dlgOpen && pinch && !lastPinch[hand.side]) onPinch(hand);
      lastPinch[hand.side] = pinch;
    }
    if (hands.length === 0) { lastGesture = {}; lastPinch = {}; }
  }

  // 2. 星空背景
  background(SKY_DEEP);
  updateParallax();
  drawBackground();
  if (started && showCamera) drawCamera();

  // 3. 星星
  for (const s of stars) {
    updateStar(s);
    drawStar(s);
  }
  drawBokehs();
  drawShootingStar();

  // 4. 星盘：拧动手掌旋转（外顺、中逆、内慢）；对齐即解密成功
  let twist = handTwistDelta();
  if (magicCircle.open && !magicCircle.solved) {
    magicCircle.rot += twist * 0.7;
    checkStarDiskAlign();
  }
  if (magicCircle.solved) {
    magicCircle.rot = lerp(magicCircle.rot, magicCircle.snapRot, 0.18);
  }
  drawMagicCircle(magicCircle);
  if (magicCircle.open && !summoned) {
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(16);
    fill(255, 224, 150, 200);
    text(magicCircle.solved
      ? `星盘已对齐 ✨ 拇指与食指捏合 🤏 显现「${zodiacs[current].name}」`
      : `拧动手掌，让外圈与中圈的「${zodiacs[current].name}」相遇`, width / 2, 36);
  }

  // 5. 当前星座：被捏合召唤时渐渐显形
  const z = zodiacs[current];
  if (z) {
    if (summoned) z.alpha = min(1, z.alpha + 0.01);
    drawConstellation(z);
    if (z.alpha > 0.01) {
      noStroke();
      fill(200, 220, 255, 160 * z.alpha);
      textSize(18);
      textAlign(CENTER, CENTER);
      text(`${z.name} · ${z.latin}`, width / 2, height - 32);
    }
    // 星座完全显现：稍停片刻，弹出烬的通关对话（🖐 张开手掌逐句推进）
    if (summoned && z.alpha >= 1 && !dlgOpen && !exitSent) {
      if (!exitAt) {
        exitAt = frameCount;
        setStatus(`「${z.name}」已显现 ✨`);
      }
      if (frameCount > exitAt + 60) { // 约 1 秒后进入对话
        dlgOpen = true;
        dlgLine = 0;
        setStatus("🖐 张开手掌继续对话");
      }
    }
  }

  // 6. 食指指尖的小光点 + 手势信息
  if (started) {
    for (const hand of hands) {
      noStroke();
      fill(255, 230, 120, 200);
      circle(hand.points[8].x, hand.points[8].y, 10);
    }
    if (showInfo) drawGestureInfo();
  }

  // 7. 常驻操作指引：所有操作要求直接显示在画面里（星座显现 / 对话时隐藏）
  if (started && !summoned) drawGuide();

  // 8. 通关对话（盖在最上层）
  if (dlgOpen) drawDlg();
}

// 常驻操作指引（底部中央）：完整流程 + 辅助按键
function drawGuide() {
  push();
  textFont("'Songti SC', 'STSong', 'SimSun', 'Microsoft YaHei', serif");
  textAlign(CENTER, BOTTOM);
  noStroke();
  rectMode(CENTER);
  fill(5, 18, 46, 130); // 淡底带，保证在星空上可读
  rect(width / 2, height - 52, min(width - 40, 880), 56, 10);
  fill(255, 224, 150, 235);
  textSize(17);
  text("🖐 张开手掌召唤星盘 → 🌀 拧动手掌对齐星座 → 🤏 捏合显现星座", width / 2, height - 56);
  fill(220, 232, 255, 150);
  textSize(13);
  text("☝️ 食指向上点亮引导星 · ESC 手势教程 · V 摄像头画面 · I 手势信息", width / 2, height - 30);
  pop();
}

// 通关对话：底部渐变暗带 + 烬·平静闭眼立绘 + 闪烁的「🖐 张开手掌继续」
function drawDlg() {
  push();
  const bandH = height * 0.36;
  const y0 = height - bandH;
  const grad = drawingContext.createLinearGradient(0, y0, 0, height);
  grad.addColorStop(0, "rgba(2, 4, 14, 0)");
  grad.addColorStop(0.45, "rgba(2, 4, 14, 0.72)");
  grad.addColorStop(1, "rgba(2, 4, 14, 0.94)");
  drawingContext.fillStyle = grad;
  drawingContext.fillRect(0, y0, width, bandH);

  textFont("'Songti SC', 'STSong', 'SimSun', 'Microsoft YaHei', serif");
  noStroke();

  // 立绘（左下，底部对齐，保比例）
  let textX = width * 0.06;
  if (dlgPortraitImg && dlgPortraitImg.width > 1) {
    const ph = height * 0.68;
    const pw = ph * (dlgPortraitImg.width / dlgPortraitImg.height);
    imageMode(CORNER);
    image(dlgPortraitImg, width * 0.035, height - ph, pw, ph);
    textX = width * 0.035 + pw + width * 0.03;
  }

  // 名字 + 台词
  textAlign(LEFT, TOP);
  fill(148, 227, 222);
  textSize(min(32, width * 0.02 + 14));
  textStyle(BOLD);
  text("烬", textX, y0 + bandH * 0.16);
  textStyle(NORMAL);
  fill(255);
  textSize(min(26, width * 0.016 + 12));
  text(PUZZLE_DIALOGUE[dlgLine], textX, y0 + bandH * 0.16 + 52, width - textX - width * 0.06);

  // 闪烁提示
  const blink = 150 + 105 * sin(frameCount * 0.1);
  textAlign(RIGHT, BOTTOM);
  textSize(18);
  fill(255, 224, 150, blink);
  text("🖐 张开手掌继续 ▼", width - 30, height - 22);
  pop();
}

// 推进对话；说完最后一句 → 通知主页面：退出星盘，点亮路灯
function advanceDlg() {
  if (!dlgOpen) return;
  dlgLine++;
  if (dlgLine >= PUZZLE_DIALOGUE.length) {
    dlgOpen = false;
    exitSent = true;
    setStatus("返回灯芯镇，灯火亮起…");
    if (window.parent && window.parent !== window) {
      window.parent.postMessage("puzzle-solved", "*");
    }
  }
}

function drawStar(s) {
  let pulse = 0.7 + 0.3 * sin(frameCount * 0.06 * s.speed + s.phase);
  let r = s.r * pulse;
  noStroke();
  for (let i = 4; i >= 1; i--) {
    fill(s.tint[0], s.tint[1], s.tint[2], 18);
    circle(s.x, s.y, r * i * 1.8);
  }
  fill(255, 252, 235);
  circle(s.x, s.y, r);
  stroke(255, 245, 210, 90 * pulse);
  strokeWeight(1);
  line(s.x - r * 2.2, s.y, s.x + r * 2.2, s.y);
  line(s.x, s.y - r * 2.2, s.x, s.y + r * 2.2);
  noStroke();
}

function updateStar(s) {
  if (s.hasTarget === false) {
    s.x = s.homeX + (noise(s.seed, frameCount * 0.001) - 0.5) * 40;
    s.y = s.homeY + (noise(s.seed + 100, frameCount * 0.001) - 0.5) * 40;
    s.px = s.x;
    s.py = s.y;
  } else {
    let dx = s.tx - s.x;
    let dy = s.ty - s.y;
    s.x += dx * 0.07 + (-dy) * 0.012;
    s.y += dy * 0.07 + dx * 0.012;
  }
  stroke(170, 210, 255, 80);
  strokeWeight(1.5);
  line(s.px, s.py, s.x, s.y);
  noStroke();
  s.px = s.x;
  s.py = s.y;
}

// ---------- 星盘 ----------
function initStarDisk() {
  const mc = magicCircle;
  const base = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  mc.outerOrder = shuffle(base.slice());
  mc.midOrder = shuffle(base.slice());
  mc.solved = false;
  mc.solvedT = 0;
  const step = TWO_PI / 12;
  let guard = 0;
  while (guard++ < 30) {
    let delta = 2 * mc.rot + (mc.outerOrder.indexOf(current) - mc.midOrder.indexOf(current)) * step;
    delta = atan2(sin(delta), cos(delta));
    if (abs(delta) >= 0.15) break;
    mc.midOrder = shuffle(base.slice());
  }
}

function checkStarDiskAlign() {
  const mc = magicCircle;
  const step = TWO_PI / 12;
  const i = mc.outerOrder.indexOf(current);
  const j = mc.midOrder.indexOf(current);
  let delta = 2 * mc.rot + (i - j) * step;
  delta = atan2(sin(delta), cos(delta));
  if (abs(delta) < 0.04) {
    mc.solved = true;
    mc.snapRot = mc.rot - delta / 2;
    setStatus(`星盘已对齐 ✨ 拇指与食指捏合 🤏 显现「${zodiacs[current].name}」`);
  }
}

function drawMagicCircle(mc) {
  if (mc.open === false) {
    mc.openT = 0;
    return;
  }
  if (mc.openT === 0 || mc.openT === undefined) initMagicMotes();
  mc.openT = min(1, mc.openT + 0.045);
  const appear = mc.openT;
  const ease = 1 + 2.7 * pow(appear - 1, 3) + 1.7 * pow(appear - 1, 2);
  mc.solvedT = lerp(mc.solvedT || 0, mc.solved ? 1 : 0, 0.08);
  const gold = mc.solvedT;
  const breath = 1 + (0.01 + gold * 0.02) * sin(frameCount * 0.05);
  const pulse = (0.72 + (0.28 + gold * 0.22) * sin(frameCount * 0.04)) * appear;
  const boost = 1 + gold * 0.45;
  const R = mc.R * breath * ease;
  const cx = mc.x, cy = mc.y;

  noFill();
  blendMode(ADD);

  for (let k = 4; k >= 1; k--) {
    stroke(255, 196, 90, (5 + gold * 5) * pulse);
    strokeWeight(R * 0.10 * k);
    circle(cx, cy, 2 * R);
  }

  const rotO = mc.rot;
  const rotM = mc.rot * -1;
  const rotI = mc.rot * 0.5;
  const step = TWO_PI / 12;
  const slotI = mc.outerOrder.indexOf(current);
  const slotJ = mc.midOrder.indexOf(current);

  magicRing(cx, cy, 2 * R, 255, 200, 95, 2.2, 130 * pulse * boost);
  magicRing(cx, cy, 1.88 * R, 255, 200, 95, 1.6, 110 * pulse * boost);
  magicRing(cx, cy, 1.52 * R, 255, 200, 95, 1, 80 * pulse * boost);
  for (let k = 0; k < 12; k++) {
    const a = rotO + (k + 0.5) * step;
    magicLine(cx + cos(a) * R * 0.76, cy + sin(a) * R * 0.76,
              cx + cos(a) * R * 1.08, cy + sin(a) * R * 1.08,
              255, 205, 100, 1.1, 85 * pulse * boost);
  }
  for (let k = 0; k < 12; k++) {
    const a = rotO + k * step;
    zodiacGlyph(ROMAN[k], cx + cos(a) * R * 0.80, cy + sin(a) * R * 0.80,
                R * 0.07, a + HALF_PI, 0.45 * pulse * boost, false);
  }
  for (let k = 0; k < 12; k++) {
    const a = rotO + k * step;
    const z = mc.outerOrder[k];
    const isTarget = z === current;
    const px = cx + cos(a) * R * 0.94;
    const py = cy + sin(a) * R * 0.94;
    if (isTarget) {
      noStroke();
      fill(255, 214, 120, 34 * pulse);
      circle(px, py, R * 0.16);
      noFill();
    }
    zodiacGlyph(ZODIAC_GLYPHS[z], px, py, R * (isTarget ? 0.14 : 0.115), a + HALF_PI,
                (isTarget ? 1 : 0.8) * pulse * boost, isTarget || gold > 0.5);
  }

  magicRing(cx, cy, 1.32 * R, 255, 214, 120, 1.2, 100 * pulse * boost);
  magicRing(cx, cy, 1.22 * R, 255, 214, 120, 1.2, 100 * pulse * boost);
  for (let k = 0; k < 12; k++) {
    const a = rotM + k * step;
    const z = mc.midOrder[k];
    const isTarget = z === current;
    const px = cx + cos(a) * R * 1.27;
    const py = cy + sin(a) * R * 1.27;
    if (isTarget) {
      noStroke();
      fill(255, 214, 120, 30 * pulse);
      circle(px, py, R * 0.12);
      noFill();
    }
    zodiacGlyph(ZODIAC_GLYPHS[z], px, py, R * (isTarget ? 0.105 : 0.085), a + HALF_PI,
                (isTarget ? 0.95 : 0.6) * pulse * boost, isTarget || gold > 0.5);
  }

  if (!mc.solved) {
    const meetA = (slotI + slotJ) * step * 0.5;
    const tw = 0.5 + 0.5 * sin(frameCount * 0.06);
    magicLine(cx + cos(meetA) * R * 0.60, cy + sin(meetA) * R * 0.60,
              cx + cos(meetA) * R * 1.10, cy + sin(meetA) * R * 1.10,
              255, 230, 160, 1, (20 + 25 * tw) * pulse);
    noStroke();
    fill(255, 230, 160, (80 + 60 * tw) * pulse);
    circle(cx + cos(meetA) * R * 1.11, cy + sin(meetA) * R * 1.11, 5);
    noFill();
  }

  const eyeR = lerp(130, 255, gold), eyeG = lerp(185, 224, gold), eyeB = lerp(255, 150, gold);
  for (let k = 0; k < 12; k++) {
    const a = rotI + k * step;
    magicLine(cx + cos(a) * R * 0.17, cy + sin(a) * R * 0.17,
              cx + cos(a) * R * 0.58, cy + sin(a) * R * 0.58,
              eyeR, eyeG, eyeB, 0.8, 26 * pulse * boost);
  }
  push();
  translate(cx, cy);
  rotate(rotI * 0.6);
  magicEllipseArc(0, 0, R * 1.04, R * 0.5, PI * 0.10, PI * 0.90, eyeR, eyeG, eyeB, 2, 90 * pulse * boost);
  magicEllipseArc(0, 0, R * 1.04, R * 0.5, PI * 1.10, PI * 1.90, eyeR, eyeG, eyeB, 2, 90 * pulse * boost);
  pop();
  noStroke();
  fill(lerp(10, 72, gold), lerp(24, 46, gold), lerp(64, 12, gold), 150 * pulse);
  circle(cx, cy, R * 0.38);
  magicRing(cx, cy, R * 0.38, eyeR, eyeG, eyeB, 2, 120 * pulse * boost);
  magicRing(cx, cy, R * 0.30, eyeR, eyeG, eyeB, 1.2, 90 * pulse * boost);
  fill(eyeR, eyeG, eyeB, 26 * pulse);
  circle(cx - R * 0.05, cy - R * 0.04, R * 0.16);
  circle(cx + R * 0.06, cy + R * 0.05, R * 0.12);
  for (let k = 3; k >= 1; k--) {
    fill(255, 250, 235, 26 * pulse * boost);
    circle(cx, cy, R * 0.05 * k);
  }
  fill(255, 252, 244, 220 * pulse);
  circle(cx, cy, R * 0.03);

  for (const m of magicMotes) {
    const a = m.a0 + frameCount * m.spd;
    const px = cx + cos(a) * R * m.rr;
    const py = cy + sin(a) * R * m.rr;
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * sin(frameCount * 0.07 + m.tw));
    fill(255, 214, 120, 36 * tw * appear);
    circle(px, py, m.sz * 3.2);
    fill(255, 246, 220, 200 * tw * appear);
    circle(px, py, m.sz);
  }

  blendMode(BLEND);
}

function magicLine(x1, y1, x2, y2, r, g, b, w, a) {
  stroke(r, g, b, a * 0.10);
  strokeWeight(w * 5);
  line(x1, y1, x2, y2);
  stroke(r, g, b, a * 0.30);
  strokeWeight(w * 2.2);
  line(x1, y1, x2, y2);
  stroke(r, g, b, a);
  strokeWeight(w);
  line(x1, y1, x2, y2);
  stroke(255, 246, 220, a * 0.85);
  strokeWeight(max(w * 0.4, 0.6));
  line(x1, y1, x2, y2);
}

function magicRing(x, y, d, r, g, b, w, a) {
  stroke(r, g, b, a * 0.10);
  strokeWeight(w * 5);
  circle(x, y, d);
  stroke(r, g, b, a * 0.30);
  strokeWeight(w * 2.2);
  circle(x, y, d);
  stroke(r, g, b, a);
  strokeWeight(w);
  circle(x, y, d);
  stroke(255, 246, 220, a * 0.85);
  strokeWeight(max(w * 0.4, 0.6));
  circle(x, y, d);
}

function magicEllipseArc(x, y, w, h, a0, a1, r, g, b, wt, a) {
  stroke(r, g, b, a * 0.10);
  strokeWeight(wt * 5);
  arc(x, y, w, h, a0, a1);
  stroke(r, g, b, a * 0.30);
  strokeWeight(wt * 2.2);
  arc(x, y, w, h, a0, a1);
  stroke(r, g, b, a);
  strokeWeight(wt);
  arc(x, y, w, h, a0, a1);
  stroke(255, 246, 220, a * 0.85);
  strokeWeight(max(wt * 0.4, 0.6));
  arc(x, y, w, h, a0, a1);
}

function zodiacGlyph(txt, x, y, size, rot, alpha, hot) {
  const a = min(1, alpha);
  push();
  translate(x, y);
  rotate(rot);
  textAlign(CENTER, CENTER);
  textSize(size);
  textFont("'Segoe UI Symbol', 'Noto Sans Symbols 2', 'Apple Symbols', serif");
  noStroke();
  drawingContext.shadowColor = `rgba(255, 214, 120, ${0.9 * a})`;
  drawingContext.shadowBlur = size * 0.5;
  fill(255, 222, 140, 255 * a);
  text(txt, 0, 0);
  text(txt, 0, 0);
  drawingContext.shadowBlur = 0;
  if (hot) {
    fill(255, 252, 240, 230 * a);
    text(txt, 0, 0);
  }
  pop();
}

let magicMotes = [];
function initMagicMotes() {
  magicMotes = [];
  const n = min(width, height) < 600 ? 12 : 26;
  for (let i = 0; i < n; i++) {
    magicMotes.push({
      rr: random(0.15, 1.08),
      a0: random(TWO_PI),
      spd: random(0.001, 0.004) * (random() < 0.5 ? -1 : 1),
      tw: random(TWO_PI),
      sz: random(2, 4.5),
    });
  }
}

function drawConstellation(c) {
  if (c.alpha <= 0.01) return;
  let flicker = 0.75 + 0.25 * sin(frameCount * 0.08 + c.phase);
  let a = c.alpha * flicker;
  stroke(200, 225, 255, 220 * a);
  strokeWeight(1.2);
  for (const l of c.links) {
    let n1 = c.nodes[l[0]];
    let n2 = c.nodes[l[1]];
    line(n1.x, n1.y, n2.x, n2.y);
  }
  noStroke();
  for (const n of c.nodes) {
    fill(190, 215, 255, 60 * a);
    circle(n.x, n.y, 14);
    fill(255, 250, 230, 255 * a);
    circle(n.x, n.y, 4);
  }
}

// ---------- 手势动作（单关卡版：只保留召唤 / 引导星） ----------
function onGesture(g, hand) {
  let tip = hand.points[8];
  // ☝️ 食指向上：在指尖点亮一颗引导星（装饰）
  if (g === "Pointing_Up" && stars.length < MAX_STARS) {
    spawnGuideStar(tip.x, tip.y);
  }
  // 🖐 张开手掌：召唤星盘
  if (g === "Open_Palm" && magicCircle.open === false) {
    magicCircle.open = true;
    setStatus(`拧动手掌，让外圈与中圈的「${zodiacs[current].name}」相遇`);
  }
}

function spawnGuideStar(x, y) {
  const g = newStar(x, y, random(4, 6));
  g.tint = [255, 215, 130];
  stars.push(g);
}

// 🤏 召唤：让一部分星星飞向当前星座的恒星位置
function summonConstellation() {
  const z = zodiacs[current];
  if (!z) return;
  const chosen = shuffle([...stars]).slice(0, floor(stars.length * 0.55));
  for (const s of chosen) {
    const n = random(z.nodes);
    s.tx = n.x + random(-8, 8);
    s.ty = n.y + random(-8, 8);
    s.hasTarget = true;
  }
  summoned = true;
  setStatus(`「${z.name}」正在显现…`);
}

// ---------- 流星 ----------
let meteor = null;

function drawShootingStar() {
  if (meteor === null && frameCount % 300 === 0) {
    let a = random(PI * 0.15, PI * 0.35);
    let speed = random(9, 14);
    meteor = {
      x: random(width * 0.1, width * 0.9),
      y: random(height * 0.05, height * 0.3),
      vx: cos(a) * speed * (random() < 0.5 ? 1 : -1),
      vy: sin(a) * speed,
      life: 0,
      maxLife: 45,
    };
  }
  if (meteor === null) return;
  meteor.x += meteor.vx;
  meteor.y += meteor.vy;
  meteor.life++;
  let fade = 1 - meteor.life / meteor.maxLife;
  let tail = 14;
  for (let i = 0; i < tail; i++) {
    let t1 = i / tail;
    let t2 = (i + 1) / tail;
    stroke(200, 220, 255, 160 * fade * (1 - t1));
    strokeWeight(2 * (1 - t1) + 0.5);
    line(meteor.x - meteor.vx * t1 * 6, meteor.y - meteor.vy * t1 * 6,
         meteor.x - meteor.vx * t2 * 6, meteor.y - meteor.vy * t2 * 6);
  }
  noStroke();
  fill(200, 225, 255, 90 * fade);
  circle(meteor.x, meteor.y, 10);
  fill(255, 250, 235, 220 * fade);
  circle(meteor.x, meteor.y, 4);
  if (meteor.life >= meteor.maxLife || meteor.x < -100 || meteor.x > width + 100 || meteor.y > height + 100) {
    meteor = null;
  }
}

// ---------- 星空视差背景 ----------
let parX = 0, parY = 0;
let lastMouseMove = -999;

function mouseMoved() {
  lastMouseMove = frameCount;
}

function updateParallax() {
  let tx, ty;
  if (started && hands.length > 0) {
    const palm = hands[0].points[9];
    tx = (0.5 - palm.x / width) * 2;
    ty = (0.5 - palm.y / height) * 2;
  } else if (frameCount - lastMouseMove < 180) {
    tx = (0.5 - mouseX / width) * 2;
    ty = (0.5 - mouseY / height) * 2;
  } else {
    tx = sin(frameCount * 0.003) * 0.35;
    ty = cos(frameCount * 0.0023) * 0.25;
  }
  parX = lerp(parX, tx, 0.06);
  parY = lerp(parY, ty, 0.06);
}

function drawBackground() {
  const s = max(width / BG_W, height / BG_H);
  const str = min(width, height) * 0.16;
  push();
  imageMode(CENTER);
  for (const L of BG_LAYERS) {
    const img = bgImg[L.img];
    if (!img) continue;
    const ox = parX * L.depth * str;
    const oy = parY * L.depth * str * 0.7;
    const bleed = 1.06 + L.depth * 0.15;
    if (L.blend === "screen") blendMode(SCREEN);
    if (L.tint) tint(L.tint[0], L.tint[1], L.tint[2], L.alpha === undefined ? 255 : L.alpha);
    else if (L.alpha !== undefined) tint(255, L.alpha);
    else noTint();
    for (const it of L.items) {
      const x = (it[0] - BG_W / 2) * s + width / 2 + ox;
      const y = (it[1] - BG_H / 2) * s + height / 2 + oy;
      image(img, x, y, it[3] * it[2] * s * bleed, it[4] * it[2] * s * bleed);
    }
    if (L.blend === "screen") blendMode(BLEND);
  }
  pop();
}

// ---------- 失焦光斑 ----------
let bokehs = [];

function initBokehs() {
  bokehs = [];
  const tints = [[120, 170, 255], [90, 220, 220], [160, 150, 255], [200, 225, 255]];
  const m = min(width, height) < 600 ? 6 : 9;
  for (let i = 0; i < m; i++) {
    bokehs.push({
      x: random(width), y: random(height * 0.9),
      r: random(10, 26),
      phase: random(TWO_PI), seed: random(1000),
      tint: random(tints),
    });
  }
}

function drawBokehs() {
  noStroke();
  for (const b of bokehs) {
    b.x += (noise(b.seed, frameCount * 0.0006) - 0.5) * 1.2;
    b.y += (noise(b.seed + 50, frameCount * 0.0006) - 0.5) * 1.2;
    let glow = 0.55 + 0.45 * sin(frameCount * 0.02 + b.phase);
    fill(b.tint[0], b.tint[1], b.tint[2], 14 * glow);
    circle(b.x, b.y, b.r * 2.6);
    fill(b.tint[0], b.tint[1], b.tint[2], 30 * glow);
    circle(b.x, b.y, b.r * 1.5);
    fill(255, 255, 255, 60 * glow);
    circle(b.x, b.y, b.r * 0.55);
  }
}

// ---------- 手掌拧动驱动法阵 ----------
let prevHandAngle = null;

function handTwistDelta() {
  if (!started || hands.length === 0) {
    prevHandAngle = null;
    return 0;
  }
  const p0 = hands[0].points[0];
  const p9 = hands[0].points[9];
  const angle = atan2(p9.y - p0.y, p9.x - p0.x);
  if (prevHandAngle === null) {
    prevHandAngle = angle;
    return 0;
  }
  let delta = angle - prevHandAngle;
  delta = atan2(sin(delta), cos(delta));
  prevHandAngle = angle;
  return constrain(delta, -0.18, 0.18);
}

function keyPressed() {
  if (keyCode === 27) { toggleTutorial(); return false; } // ESC：教程页
  // 对话中的键盘兜底：Enter / 空格 / E 也能推进（🖐 手势为主）
  if (dlgOpen && (keyCode === ENTER || keyCode === 32 || key === "e" || key === "E")) { advanceDlg(); return false; }
  if (key === "v" || key === "V") showCamera = !showCamera;
  if (key === "i" || key === "I") showInfo = !showInfo;
}

// 没有摄像头时：点击画面也能推进对话
function mousePressed() {
  if (dlgOpen) advanceDlg();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  magicCircle.x = width / 2;
  magicCircle.y = height / 2;
  magicCircle.R = min(width, height) * 0.32;
  initStars();
  initBokehs();
  layoutConstellations();
}
