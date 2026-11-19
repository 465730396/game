'use strict';

// 小程序 Canvas 2D 特效（精简自 H5 fx.js）：星空 / 黄土高原 / 窑洞暖光 / 孔明灯 / 烟花。
//
// [PERF 2026-11-19] 性能改造，起因：牌桌页常驻 60fps，每帧约 158 次绘制 + 9 个径向渐变，
// 在低端机上是发热和掉电的主因，而静态风景其实一帧都不会变。三处改动：
//   1. 静态层（山脉 + 窑洞 + 暖光）预渲染到离屏画布，每帧只 blit 一次，
//      取代 3 层 ~78 段 lineTo 与 4 个径向渐变；
//   2. 孔明灯的光晕预渲染成一张贴图，每帧只 drawImage + globalAlpha，
//      不再每帧 new 4 个 canvasGradient；
//   3. 帧率上限 30fps。背景动画是缓慢漂移，30fps 与 60fps 肉眼无差，但耗电差一倍。
// 离屏画布不可用时（低版本基础库）自动退回逐帧绘制，功能不受影响，只是回到旧开销。

var TARGET_MS = 30;   // ≈30fps。
// 阈值取 30 而不是 33 是有原因的：rAF 回调按 16/17ms 的时间片到达，若阈值取 33，
// 恰好落在"两帧 32ms 不够、三帧 48ms 才过"的夹缝里，实际会退化成 20fps。
var STAR_COUNT = 56;  // 原 80
var LANTERN_COUNT = 4; // 原 5
var MOUNTAIN_STEP = 26; // 原 18，lineTo 数量减三分之一

function rand(a, b) { return a + Math.random() * (b - a); }

function createFX(page, selector) {
  var canvas = null, ctx = null;
  var w = 0, h = 0, dpr = 1;
  var rafId = null, timer = null, running = false, celebration = 0;
  var stars = [], lanterns = [], sparks = [];
  var mounted = false, lastDraw = 0;
  var bg = null;            // 离屏静态层（山脉 + 窑洞）
  var lanternSprite = null; // 离屏灯笼光晕

  // 离屏画布：基础库 2.16.1+ 支持，取不到就返回 null 走退路
  function offscreen(pxW, pxH) {
    if (typeof wx === 'undefined' || typeof wx.createOffscreenCanvas !== 'function') return null;
    try {
      return wx.createOffscreenCanvas({ type: '2d', width: Math.ceil(pxW), height: Math.ceil(pxH) });
    } catch (e) { return null; }
  }

  function build() {
    stars = [];
    for (var i = 0; i < STAR_COUNT; i++) {
      stars.push({ x: rand(0, w), y: rand(0, h * 0.68), r: rand(0.5, 1.6), p: rand(0, 6.28), s: rand(0.006, 0.026) });
    }
    lanterns = [];
    for (var j = 0; j < LANTERN_COUNT; j++) {
      lanterns.push({ x: rand(w * 0.06, w * 0.94), y: rand(0, h), size: rand(0.6, 1.1), sway: rand(0, 6.28), alpha: rand(0.35, 0.75), speed: rand(0.16, 0.4) });
    }
    sparks = [];
    buildStatic();
    buildLanternSprite();
  }

  function drawMountains(c) {
    var layers = [
      { y: h * 0.70, amp: 18, color: 'rgba(93,52,40,.42)' },
      { y: h * 0.79, amp: 26, color: 'rgba(62,34,29,.62)' },
      { y: h * 0.88, amp: 34, color: 'rgba(34,20,18,.88)' }
    ];
    layers.forEach(function (L, li) {
      c.fillStyle = L.color;
      c.beginPath(); c.moveTo(0, h); c.lineTo(0, L.y);
      for (var x = 0; x <= w + 20; x += MOUNTAIN_STEP) {
        c.lineTo(x, L.y + Math.sin(x * 0.006 + li * 1.7) * L.amp + Math.sin(x * 0.017 + li * 3.1) * L.amp * 0.42);
      }
      c.lineTo(w, h); c.closePath(); c.fill();
    });
  }

  function drawYaodong(c) {
    var baseY = h * 0.94;
    c.fillStyle = 'rgba(22,13,11,.94)'; c.fillRect(0, baseY, w, h - baseY);
    for (var i = 0; i < 4; i++) {
      var cx = w * (0.14 + i * 0.24);
      var rw = Math.min(30, w * 0.07), rh = rw * 1.22;
      c.fillStyle = 'rgba(26,15,13,.96)';
      c.beginPath(); c.moveTo(cx - rw, baseY); c.lineTo(cx - rw, baseY - rh * 0.48);
      c.arc(cx, baseY - rh * 0.48, rw, Math.PI, 0); c.lineTo(cx + rw, baseY); c.closePath(); c.fill();
      var g = c.createRadialGradient(cx, baseY - 16, 1, cx, baseY - 16, rw * 0.85);
      g.addColorStop(0, 'rgba(255,190,88,.75)'); g.addColorStop(1, 'rgba(255,130,40,0)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, baseY - 16, rw * 0.85, 0, Math.PI * 2); c.fill();
    }
  }

  // 静态风景只画一次，存进离屏画布；失败则每帧现画
  function buildStatic() {
    bg = null;
    var off = offscreen(w * dpr, h * dpr);
    if (!off) return;
    try {
      var c = off.getContext('2d');
      if (!c) return;
      c.scale(dpr, dpr);
      drawMountains(c);
      drawYaodong(c);
      bg = off;
    } catch (e) { bg = null; }
  }

  // 灯笼光晕贴图：96×96 的径向渐变，绘制时按尺寸缩放 + globalAlpha 控透明度
  function buildLanternSprite() {
    lanternSprite = null;
    var size = 96;
    var off = offscreen(size, size);
    if (!off) return;
    try {
      var c = off.getContext('2d');
      if (!c) return;
      var r = size / 2;
      var g = c.createRadialGradient(r, r, 1, r, r, r);
      g.addColorStop(0, 'rgba(255,196,96,0.85)');
      g.addColorStop(0.45, 'rgba(255,145,50,0.3)');
      g.addColorStop(1, 'rgba(255,120,30,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(r, r, r, 0, Math.PI * 2); c.fill();
      lanternSprite = off;
    } catch (e) { lanternSprite = null; }
  }

  function drawStars() {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.p += s.s;
      ctx.fillStyle = 'rgba(255,236,196,' + (0.25 + Math.abs(Math.sin(s.p)) * 0.7) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawLanterns() {
    for (var i = 0; i < lanterns.length; i++) {
      var L = lanterns[i];
      L.y -= L.speed; L.sway += 0.012;
      if (L.y < -50) { L.y = h + 40; L.x = rand(w * 0.04, w * 0.96); }
      var x = L.x + Math.sin(L.sway) * 16, r = 30 * L.size;
      if (lanternSprite) {
        ctx.globalAlpha = L.alpha;
        ctx.drawImage(lanternSprite, x - r, L.y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
      } else {
        var g = ctx.createRadialGradient(x, L.y, 1, x, L.y, r);
        g.addColorStop(0, 'rgba(255,196,96,' + (L.alpha * 0.85) + ')');
        g.addColorStop(0.45, 'rgba(255,145,50,' + (L.alpha * 0.3) + ')');
        g.addColorStop(1, 'rgba(255,120,30,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, L.y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,224,150,' + L.alpha + ')';
      ctx.beginPath(); ctx.ellipse(x, L.y, 5 * L.size, 7 * L.size, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawSparks() {
    for (var i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.vy += 0.055; s.vx *= 0.992; s.life -= 0.012;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      var gold = Math.floor(170 + Math.random() * 80);
      ctx.fillStyle = 'rgba(255,' + gold + ',90,' + s.life + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.4 + 2.2 * s.life, 0, Math.PI * 2); ctx.fill();
    }
    celebration--;
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    drawStars();
    if (bg) ctx.drawImage(bg, 0, 0, w, h);
    else { drawMountains(ctx); drawYaodong(ctx); }
    drawLanterns();
    if (celebration > 0) drawSparks();
  }

  function schedule() {
    if (!running) return;
    if (canvas && canvas.requestAnimationFrame) {
      rafId = canvas.requestAnimationFrame(frame);
    } else {
      timer = setTimeout(frame, TARGET_MS);
    }
  }

  function frame() {
    if (!running || !ctx) return;
    var now = Date.now();
    // 屏幕本身 60fps，这里隔帧丢一次绘制，把负载压到 30fps
    if (now - lastDraw < TARGET_MS) { schedule(); return; }
    lastDraw = now;
    draw();
    schedule();
  }

  function start() {
    if (running || !mounted) return;
    running = true;
    lastDraw = 0;
    schedule();
  }

  function stop() {
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (rafId && canvas && canvas.cancelAnimationFrame) {
      try { canvas.cancelAnimationFrame(rafId); } catch (e) {}
    }
    rafId = null;
  }

  function mount() {
    if (mounted) return;
    wx.createSelectorQuery().in(page).select(selector).fields({ node: true, size: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) return;
      canvas = res[0].node;
      ctx = canvas.getContext('2d');
      var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      dpr = info.pixelRatio || 1;
      w = res[0].width; h = res[0].height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      build(); mounted = true; start();
    });
  }

  function celebrate() {
    if (!mounted) return;
    celebration = 120; sparks = [];
    var centers = [{ x: w * 0.3, y: h * 0.32 }, { x: w * 0.7, y: h * 0.38 }, { x: w * 0.5, y: h * 0.22 }];
    centers.forEach(function (c) {
      for (var i = 0; i < 40; i++) {
        var a = rand(0, Math.PI * 2), sp = rand(1.6, 6.4);
        sparks.push({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2, life: 1 });
      }
    });
  }

  return { mount: mount, start: start, stop: stop, celebrate: celebrate };
}

module.exports = { createFX: createFX };
