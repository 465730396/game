'use strict';

// 小程序 Canvas 2D 特效（精简自 H5 fx.js）：星空 / 黄土高原 / 窑洞暖光 / 孔明灯 / 烟花。
// 小程序无 window/document，canvas 需通过 SelectorQuery 异步取节点；动画用 canvas.requestAnimationFrame。
function rand(a, b) { return a + Math.random() * (b - a); }

function createFX(page, selector) {
  var canvas = null, ctx = null;
  var w = 0, h = 0, dpr = 1;
  var raf = null, running = false, celebration = 0;
  var stars = [], lanterns = [], sparks = [];
  var mounted = false;

  function build() {
    stars = []; for (var i = 0; i < 80; i++) {
      stars.push({ x: rand(0, w), y: rand(0, h * 0.68), r: rand(0.5, 1.6), p: rand(0, 6.28), s: rand(0.006, 0.026) });
    }
    lanterns = []; for (var j = 0; j < 5; j++) {
      lanterns.push({ x: rand(w * 0.06, w * 0.94), y: rand(0, h), size: rand(0.6, 1.1), sway: rand(0, 6.28), alpha: rand(0.35, 0.75), speed: rand(0.16, 0.4) });
    }
    sparks = [];
  }

  function drawMountains() {
    var layers = [
      { y: h * 0.70, amp: 18, color: 'rgba(93,52,40,.42)' },
      { y: h * 0.79, amp: 26, color: 'rgba(62,34,29,.62)' },
      { y: h * 0.88, amp: 34, color: 'rgba(34,20,18,.88)' }
    ];
    layers.forEach(function (L, li) {
      ctx.fillStyle = L.color;
      ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, L.y);
      for (var x = 0; x <= w + 20; x += 18) {
        ctx.lineTo(x, L.y + Math.sin(x * 0.006 + li * 1.7) * L.amp + Math.sin(x * 0.017 + li * 3.1) * L.amp * 0.42);
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    });
  }

  function drawYaodong() {
    var baseY = h * 0.94;
    ctx.fillStyle = 'rgba(22,13,11,.94)'; ctx.fillRect(0, baseY, w, h - baseY);
    for (var i = 0; i < 4; i++) {
      var cx = w * (0.14 + i * 0.24);
      var rw = Math.min(30, w * 0.07), rh = rw * 1.22;
      ctx.fillStyle = 'rgba(26,15,13,.96)';
      ctx.beginPath(); ctx.moveTo(cx - rw, baseY); ctx.lineTo(cx - rw, baseY - rh * 0.48);
      ctx.arc(cx, baseY - rh * 0.48, rw, Math.PI, 0); ctx.lineTo(cx + rw, baseY); ctx.closePath(); ctx.fill();
      var g = ctx.createRadialGradient(cx, baseY - 16, 1, cx, baseY - 16, rw * 0.85);
      g.addColorStop(0, 'rgba(255,190,88,.75)'); g.addColorStop(1, 'rgba(255,130,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, baseY - 16, rw * 0.85, 0, Math.PI * 2); ctx.fill();
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

  function frame() {
    if (!running || !ctx) return;
    ctx.clearRect(0, 0, w, h);
    stars.forEach(function (s) {
      s.p += s.s;
      ctx.fillStyle = 'rgba(255,236,196,' + (0.25 + Math.abs(Math.sin(s.p)) * 0.7) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    });
    drawMountains();
    lanterns.forEach(function (L, idx) {
      L.y -= L.speed; L.sway += 0.012;
      if (L.y < -50) { L.y = h + 40; L.x = rand(w * 0.04, w * 0.96); }
      var x = L.x + Math.sin(L.sway) * 16, r = 30 * L.size;
      var g = ctx.createRadialGradient(x, L.y, 1, x, L.y, r);
      g.addColorStop(0, 'rgba(255,196,96,' + (L.alpha * 0.85) + ')');
      g.addColorStop(0.45, 'rgba(255,145,50,' + (L.alpha * 0.3) + ')');
      g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, L.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,224,150,' + L.alpha + ')';
      ctx.beginPath(); ctx.ellipse(x, L.y, 5 * L.size, 7 * L.size, 0, 0, Math.PI * 2); ctx.fill();
    });
    drawYaodong();
    if (celebration > 0) drawSparks();
    if (canvas && canvas.requestAnimationFrame) canvas.requestAnimationFrame(frame);
    else raf = setTimeout(frame, 16);
  }

  function start() {
    if (running) return;
    running = true;
    if (canvas && canvas.requestAnimationFrame) canvas.requestAnimationFrame(frame);
    else frame();
  }

  function stop() {
    running = false;
    if (raf) { clearTimeout(raf); raf = null; }
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
    celebration = 120; sparks = [];
    var centers = [{ x: w * 0.3, y: h * 0.32 }, { x: w * 0.7, y: h * 0.38 }, { x: w * 0.5, y: h * 0.22 }];
    centers.forEach(function (c) {
      for (var i = 0; i < 50; i++) {
        var a = rand(0, Math.PI * 2), sp = rand(1.6, 6.4);
        sparks.push({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2, life: 1 });
      }
    });
  }

  return { mount: mount, start: start, stop: stop, celebrate: celebrate };
}

module.exports = { createFX: createFX };
