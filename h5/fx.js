'use strict';

// 陕北夜宴背景特效：星空 / 黄土高原 / 窑洞暖光 / 孔明灯 / 飘落剪纸 / 胜利烟花
(function () {
  var canvas, ctx, w = 0, h = 0, dpr = 1;
  var stars = [], lanterns = [], petals = [], sparks = [];
  var raf = null, celebration = 0, running = false;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function newStar() {
    return { x: rand(0, w), y: rand(0, h * 0.7), r: rand(0.4, 1.7), p: rand(0, 6.28), s: rand(0.006, 0.026) };
  }
  function newLantern(initial) {
    return {
      x: rand(w * 0.04, w * 0.96),
      y: initial ? rand(0, h) : h + 40,
      size: rand(0.55, 1.15),
      sway: rand(0, 6.28),
      alpha: rand(0.35, 0.8),
      speed: rand(0.18, 0.42)
    };
  }
  function newPetal(initial) {
    return {
      x: rand(0, w),
      y: initial ? rand(0, h) : -20,
      size: rand(0.55, 1.5),
      rot: rand(0, 6.28),
      vr: rand(-0.022, 0.022),
      vy: rand(0.18, 0.5),
      swing: rand(0, 6.28)
    };
  }

  function build() {
    stars = []; for (var i = 0; i < 110; i++) stars.push(newStar());
    lanterns = []; for (var j = 0; j < 6; j++) lanterns.push(newLantern(true));
    petals = []; for (var k = 0; k < 18; k++) petals.push(newPetal(true));
  }

  function drawMountains() {
    var layers = [
      { y: h * 0.70, amp: 20, color: 'rgba(93,52,40,.42)' },
      { y: h * 0.78, amp: 28, color: 'rgba(62,34,29,.62)' },
      { y: h * 0.87, amp: 36, color: 'rgba(34,20,18,.88)' }
    ];
    layers.forEach(function (L, li) {
      ctx.fillStyle = L.color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, L.y);
      for (var x = 0; x <= w + 20; x += 18) {
        var y = L.y + Math.sin(x * 0.006 + li * 1.7) * L.amp +
                Math.sin(x * 0.017 + li * 3.1) * L.amp * 0.42;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    });
  }

  function drawYaodong() {
    var baseY = h * 0.94;
    ctx.fillStyle = 'rgba(22,13,11,.94)';
    ctx.fillRect(0, baseY, w, h - baseY);
    for (var i = 0; i < 4; i++) {
      var cx = w * (0.14 + i * 0.24);
      var rw = Math.min(34, w * 0.07);
      var rh = rw * 1.22;
      ctx.fillStyle = 'rgba(26,15,13,.96)';
      ctx.beginPath();
      ctx.moveTo(cx - rw, baseY);
      ctx.lineTo(cx - rw, baseY - rh * 0.48);
      ctx.arc(cx, baseY - rh * 0.48, rw, Math.PI, 0);
      ctx.lineTo(cx + rw, baseY);
      ctx.closePath();
      ctx.fill();
      var g = ctx.createRadialGradient(cx, baseY - 16, 1, cx, baseY - 16, rw * 0.85);
      g.addColorStop(0, 'rgba(255,190,88,.75)');
      g.addColorStop(1, 'rgba(255,130,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, baseY - 16, rw * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,208,120,.7)';
      ctx.fillRect(cx - rw * 0.32, baseY - 25, rw * 0.64, rw * 0.5);
      ctx.strokeStyle = 'rgba(120,50,30,.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, baseY - 25); ctx.lineTo(cx, baseY - 25 + rw * 0.5);
      ctx.moveTo(cx - rw * 0.32, baseY - 25 + rw * 0.25); ctx.lineTo(cx + rw * 0.32, baseY - 25 + rw * 0.25);
      ctx.stroke();
    }
  }

  function drawSparks() {
    for (var i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i];
      s.x += s.vx; s.y += s.vy;
      s.vy += 0.055; s.vx *= 0.992;
      s.life -= 0.012;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      var gold = Math.floor(170 + Math.random() * 80);
      ctx.fillStyle = 'rgba(255,' + gold + ',90,' + s.life + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.4 + 2.2 * s.life, 0, Math.PI * 2);
      ctx.fill();
    }
    celebration--;
  }

  function loop() {
    ctx.clearRect(0, 0, w, h);

    stars.forEach(function (s) {
      s.p += s.s;
      var a = 0.25 + Math.abs(Math.sin(s.p)) * 0.7;
      ctx.fillStyle = 'rgba(255,236,196,' + a + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });

    drawMountains();

    lanterns.forEach(function (L, idx) {
      L.y -= L.speed;
      L.sway += 0.012;
      if (L.y < -50) lanterns[idx] = newLantern(false);
      var x = L.x + Math.sin(L.sway) * 16;
      var r = 30 * L.size;
      var g = ctx.createRadialGradient(x, L.y, 1, x, L.y, r);
      g.addColorStop(0, 'rgba(255,196,96,' + (L.alpha * 0.85) + ')');
      g.addColorStop(0.45, 'rgba(255,145,50,' + (L.alpha * 0.3) + ')');
      g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, L.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,224,150,' + L.alpha + ')';
      ctx.beginPath();
      ctx.ellipse(x, L.y, 5.5 * L.size, 8 * L.size, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    drawYaodong();

    petals.forEach(function (P, idx) {
      P.y += P.vy;
      P.rot += P.vr;
      P.swing += 0.03;
      if (P.y > h + 24) petals[idx] = newPetal(false);
      ctx.save();
      ctx.translate(P.x + Math.sin(P.swing) * 18, P.y);
      ctx.rotate(P.rot);
      ctx.fillStyle = 'rgba(232,64,64,.52)';
      var s = 5 * P.size;
      ctx.beginPath();
      ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    });

    if (celebration > 0) drawSparks();
    raf = requestAnimationFrame(loop);
  }

  function celebrate() {
    celebration = 150;
    sparks = [];
    var centers = [
      { x: w * 0.3, y: h * 0.32 },
      { x: w * 0.7, y: h * 0.38 },
      { x: w * 0.5, y: h * 0.22 }
    ];
    centers.forEach(function (c) {
      for (var i = 0; i < 70; i++) {
        var a = rand(0, Math.PI * 2);
        var sp = rand(1.6, 6.4);
        sparks.push({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2, life: 1 });
      }
    });
  }

  window.FX = {
    init: function (el) {
      if (running) return;
      canvas = el;
      ctx = canvas.getContext('2d');
      resize();
      build();
      window.addEventListener('resize', resize);
      running = true;
      loop();
    },
    celebrate: celebrate
  };
})();
