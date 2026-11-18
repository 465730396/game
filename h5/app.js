'use strict';

(function () {
  var engine = window.SBM.engine;
  var controller = window.SBM.controller;
  var store = window.SBM.store;

  var $ = function (id) { return document.getElementById(id); };
  var SUIT_TEXT = { S: '♠', H: '♥', C: '♣', D: '♦' };
  var ERROR_TEXT = {
    NOT_YOUR_TURN: '还没轮到你', EMPTY_PLAY: '请先选牌', CARD_NOT_IN_HAND: '选牌无效',
    FIRST_MUST_CONTAIN_H3: '第一手必须包含红桃3', INVALID_CARD_TYPE: '牌型不合法',
    ILLEGAL_PLAY: '这手牌压不过上家', CANNOT_PASS_WHEN_LEADING: '你是领出者，必须出牌',
    FORCED_TO_PLAY: '按规则必须出牌', GAME_NOT_PLAYING: '本局已结束'
  };
  var FLAG_TEXT = {
    NEED_A: '见K必出A', NEED_2: '见A必出2',
    NEED_BOMB: '见2必出炸', NEED_PAIR_A: '见对K必出对A'
  };
  var RULES = [
    ['单张 / 对子 / 三张', '按点数比大小'], ['三带一 / 三带二', '按三张点数比'],
    ['顺子', '5 张起，3 到 K'], ['连对', '3 对起，3 到 K'],
    ['飞机 / 飞机带翅膀', '2 组连续三张起'], ['炸弹', '四张同点，压任何非炸'],
    ['天炸', 'AAA / AAAA，最大牌型']
  ];

  var game = null;
  var activeSeat = 0;
  var hotseat = false;
  var selected = [];
  var aiTimer = null;
  var lastMode = null;
  var lastCount = 3;
  var lastLevel = 'NORMAL';
  var toastTimer = null;
  var settings = store.getSettings();

  // ---------- 通用 UI ----------
  function showScreen(name) {
    var all = document.querySelectorAll('.screen');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
    var target = $('screen-' + name);
    if (target) target.classList.add('active');
    window.scrollTo(0, 0);
  }

  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  function bindSegmented(id, onChange) {
    var box = $(id);
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var children = box.querySelectorAll('button');
      for (var i = 0; i < children.length; i++) children[i].classList.remove('on');
      btn.classList.add('on');
      onChange(btn.dataset.value);
    });
  }

  // ---------- 音频（程序合成，无版权素材） ----------
  var audioCtx = null;
  var bgmTimer = null;
  var bgmStep = 0;
  var SCALE = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];

  function ensureAudio() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, duration, volume, type) {
    if (!settings.dialect && !settings.bgm) return;
    var ctx = ensureAudio();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume || 0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  function playPrompt(kind) {
    if (!settings.dialect) return;
    if (kind === 'PLAY') tone(520, 0.11, 0.07, 'triangle');
    else if (kind === 'YOUR_TURN') { tone(660, 0.10, 0.08); setTimeout(function () { tone(880, 0.14, 0.07); }, 110); }
    else if (kind === 'BOMB') { tone(150, 0.28, 0.13, 'sawtooth'); setTimeout(function () { tone(110, 0.3, 0.1, 'sawtooth'); }, 130); }
  }

  function stopBgm() {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }

  function startBgm() {
    stopBgm();
    if (!settings.bgm) return;
    ensureAudio();
    bgmTimer = setInterval(function () {
      var seq = [0, 2, 4, 3, 2, 0, 1, 0];
      var f = SCALE[seq[bgmStep % seq.length]];
      tone(f, 0.36, 0.035, 'sine');
      if (bgmStep % 4 === 0) tone(f / 2, 0.5, 0.018, 'triangle');
      bgmStep++;
    }, 420);
  }

  function applySettings() {
    document.body.classList.toggle('large-font', !!settings.largeFont);
    $('toggle-bgm').setAttribute('aria-checked', settings.bgm ? 'true' : 'false');
    $('toggle-dialect').setAttribute('aria-checked', settings.dialect ? 'true' : 'false');
    $('toggle-font').setAttribute('aria-checked', settings.largeFont ? 'true' : 'false');
    settings.bgm ? startBgm() : stopBgm();
  }

  // ---------- 牌桌背景 ----------
  function drawBoard() {
    var canvas = $('board');
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var w = rect.width, h = rect.height;

    // 夜宴牌桌：深红绒布 + 金色窑洞拱门 + 中央光晕
    var g = ctx.createRadialGradient(w * 0.5, h * 0.42, 8, w * 0.5, h * 0.5, w * 0.74);
    g.addColorStop(0, '#6E2A24');
    g.addColorStop(0.56, '#3C1A1C');
    g.addColorStop(1, '#1B1018');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,216,122,.065)';
    ctx.lineWidth = 1;
    for (var t = 0; t < 15; t++) {
      ctx.beginPath();
      ctx.moveTo(0, t * 26 + 8);
      ctx.lineTo(w, t * 26 - 18);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,208,130,.28)';
    ctx.lineWidth = 2;
    for (var i = 0; i < 3; i++) {
      var cx = w * (0.25 + i * 0.25);
      ctx.beginPath();
      ctx.moveTo(cx - 28, h * 0.17);
      ctx.lineTo(cx - 28, h * 0.11);
      ctx.arc(cx, h * 0.11, 28, Math.PI, 0);
      ctx.lineTo(cx + 28, h * 0.17);
      ctx.stroke();
    }

    var glow = ctx.createRadialGradient(w / 2, h * 0.55, 3, w / 2, h * 0.55, w * 0.34);
    glow.addColorStop(0, 'rgba(255,190,100,.22)');
    glow.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.55, w * 0.34, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,216,122,.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 8, w - 16, h - 16);
  }

  // ---------- 卡牌 DOM ----------
  function cardEl(card, small, clickHandler) {
    var el = document.createElement('div');
    el.className = 'card' + (card.suit === 'H' || card.suit === 'D' ? ' red' : ' black') + (small ? ' small' : '');
    var r = document.createElement('div');
    r.className = 'card-rank';
    r.textContent = card.rank;
    var s = document.createElement('div');
    s.className = 'card-suit';
    s.textContent = SUIT_TEXT[card.suit] || '';
    el.appendChild(r); el.appendChild(s);
    if (clickHandler) el.addEventListener('click', clickHandler);
    return el;
  }

  function animateDeal() {
    var cards = document.querySelectorAll('#hand .card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].style.animationDelay = (i * 32) + 'ms';
      cards[i].classList.add('deal');
    }
  }

  function render() {
    if (!game) return;
    var hidden = hotseat && $('handoff-mask').classList.contains('show');
    var view = controller.getView(game, activeSeat);

    $('game-meta').textContent = (game.players.length + ' 人 · ') +
      (hotseat ? '同屏热座' : ({ EASY: '简单', NORMAL: '普通', HARD: '困难' }[lastLevel] || lastLevel));

    var seatRow = $('seat-row');
    seatRow.innerHTML = '';
    game.players.forEach(function (p, i) {
      var d = document.createElement('div');
      d.className = 'seat' + (i === view.public.currentSeat ? ' active' : '');
      var n = document.createElement('div');
      n.className = 'seat-name';
      n.textContent = p.name;
      var c = document.createElement('div');
      c.textContent = '剩 ' + p.hand.length + ' 张';
      d.appendChild(n); d.appendChild(c);
      if (view.public.declaredCounts[i]) {
        var b = document.createElement('div');
        b.className = 'seat-declared';
        b.textContent = '报牌 ' + view.public.declaredCounts[i];
        d.appendChild(b);
      }
      seatRow.appendChild(d);
    });

    var playCards = $('play-cards');
    playCards.innerHTML = '';
    var last = view.public.lastPlay;
    if (last && last.cards.length) {
      $('play-label').textContent = game.players[last.seat].name + ' 出 · ' + (last.detected.label || '');
      last.cards.forEach(function (c) { playCards.appendChild(cardEl(c, true)); });
    } else {
      $('play-label').textContent = '新一轮 · 自由出牌';
      var tip = document.createElement('span');
      tip.style.cssText = 'font-size:13px;color:#7A5C3E;line-height:54px';
      tip.textContent = '—';
      playCards.appendChild(tip);
    }

    var hand = $('hand');
    hand.innerHTML = '';
    $('hand-title').textContent = hidden ? '手牌已遮挡' : (hotseat ? game.players[activeSeat].name + ' 的手牌' : '我的手牌');
    if (!hidden) {
      view.hand.forEach(function (card) {
        var el = cardEl(card, false, function () { toggleCard(card.id); });
        if (selected.indexOf(card.id) >= 0) el.classList.add('selected');
        hand.appendChild(el);
      });
    }

    var status = hidden ? '请交接设备' :
      (hotseat ? '轮到 ' + game.players[view.public.currentSeat].name :
        (view.public.currentSeat === 0 ? '轮到你出牌' : game.players[view.public.currentSeat].name + ' 思考中…'));
    $('status-line').textContent = status;
    $('force-line').textContent = hidden ? '' : view.public.forceFlags.map(function (f) { return FLAG_TEXT[f] || f; }).join(' · ');

    var myTurn = !hidden && view.public.currentSeat === activeSeat;
    $('btn-play').disabled = !myTurn || view.legalPlays.length === 0 || selected.length === 0;
    $('btn-pass').disabled = !myTurn || !view.canPass;
    $('btn-hint').disabled = !myTurn || view.legalPlays.length === 0;

    if (!hidden && !hotseat && view.public.currentSeat === 0 && window.__lastSeat !== 0) playPrompt('YOUR_TURN');
    window.__lastSeat = view.public.currentSeat;
  }

  function toggleCard(id) {
    var i = selected.indexOf(id);
    if (i >= 0) selected.splice(i, 1); else selected.push(id);
    render();
  }

  function afterAction(result) {
    selected = [];
    if (hotseat && !result.finished && game.status === 'PLAYING') {
      activeSeat = game.currentSeat;
      $('handoff-name').textContent = game.players[activeSeat].name;
      $('handoff-mask').classList.add('show');
    }
    render();
    if (result.finished) finishGame();
    else scheduleAI();
  }

  function scheduleAI() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    if (!game || hotseat || game.status !== 'PLAYING') return;
    var seat = game.currentSeat;
    if (seat === 0 || !game.players[seat].isAI) return;
    aiTimer = setTimeout(function () {
      aiTimer = null;
      var res = controller.aiTakeTurn(game);
      if (!res.ok) controller.pass(game, seat);
      render();
      if (game.status === 'FINISHED') finishGame();
      else scheduleAI();
    }, 620);
  }

  function startGame(count, level, isHotseat) {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    lastCount = count; lastLevel = level; lastMode = isHotseat ? 'HOTSEAT' : 'AI';
    hotseat = isHotseat;
    selected = [];
    window.__lastSeat = null;
    var difficulties = [level, level, level, level];
    var names = [];
    for (var i = 0; i < count; i++) names.push(hotseat ? ('玩家 ' + (i + 1)) : (i === 0 ? '我' : 'AI ' + i));
    game = controller.createGame({ playerCount: count, difficulties: difficulties, names: names });
    if (hotseat) game.players.forEach(function (p) { p.isAI = false; });
    activeSeat = game.currentSeat;
    $('handoff-mask').classList.remove('show');
    showScreen('game');
    drawBoard();
    render();
    animateDeal();
    scheduleAI();
  }

  function finishGame() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    var s = game.settlement;
    var won = game.winnerSeat === 0;
    // [FIX 2026-11-18] 热座模式所有座位都是真人，须为每位玩家各记一条战绩。
    // 旧实现只记 seat0，其余玩家战绩全部丢失；人机模式仍只记 seat0（唯一真人）。
    s.scores.forEach(function (row) {
      if (!hotseat && row.seat !== 0) return;
      store.addRecord({
        name: row.name, mode: lastMode, delta: row.delta, rank: row.rank,
        winner: row.seat === game.winnerSeat, ruleSetId: game.config.ruleSetId, createdAt: Date.now()
      });
    });
    // 热座没有单一"我"，只累计总局数；胜局/累计积分仍以人机模式的 seat0 为准。
    if (hotseat) store.updateStats(false, 0);
    else {
      var human = s.scores.filter(function (x) { return x.seat === 0; })[0];
      store.updateStats(won, human.delta);
    }
    playPrompt(won ? 'YOUR_TURN' : 'PLAY');
    if (window.FX) window.FX.celebrate();

    $('result-badge').textContent = won ? '胜' : '负';
    // 热座下不出现"你"，明确显示赢家名号。
    $('result-title').textContent = (hotseat || !won) ?
      (game.players[game.winnerSeat].name + ' 赢下这一局') : '你赢下这一局';
    $('result-sub').textContent = '娱乐积分 · ' + game.config.ruleSetId + ' · ' +
      new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

    var box = $('result-scores');
    box.innerHTML = '<div class="panel-title">本局积分</div>';
    s.scores.slice().sort(function (a, b) { return a.rank - b.rank; }).forEach(function (row) {
      var d = document.createElement('div');
      d.className = 'score-row';
      var delta = row.delta > 0 ? ('+' + row.delta) : String(row.delta);
      d.innerHTML = '<span><span class="rank-chip' + (row.rank === 1 ? ' first' : '') + '">' + row.rank +
        '</span><span class="score-name">' + row.name + '</span></span>' +
        '<span class="score-delta ' + (row.delta > 0 ? 'up' : 'down') + '">' + delta + '</span>';
      box.appendChild(d);
    });
    showScreen('result');
  }

  function renderStats() {
    var stats = store.getStats();
    var grid = $('stat-grid');
    grid.innerHTML = '';
    [['总局数', stats.games], ['胜局', stats.wins], ['逃跑', stats.escapes || 0],
     ['累计积分', stats.totalScore]].forEach(function (pair) {
      var c = document.createElement('div');
      c.className = 'stat-cell';
      c.innerHTML = '<div class="stat-num">' + pair[1] + '</div><div class="stat-label">' + pair[0] + '</div>';
      grid.appendChild(c);
    });

    var lb = $('leaderboard');
    lb.innerHTML = '';
    var list = store.getLocalLeaderboard();
    if (!list.length) lb.innerHTML = '<div class="empty">还没有战绩，先打一局吧</div>';
    list.forEach(function (row, i) {
      var d = document.createElement('div');
      d.className = 'list-row';
      d.innerHTML = '<span>' + (i + 1) + '. ' + row.name + ' <small>(' + row.games + ' 局)</small></span><b>' + row.score + '</b>';
      lb.appendChild(d);
    });

    var rec = $('recent-records');
    rec.innerHTML = '';
    var records = store.getRecords().slice(0, 12);
    if (!records.length) rec.innerHTML = '<div class="empty">暂无记录</div>';
    records.forEach(function (r) {
      var d = document.createElement('div');
      d.className = 'list-row';
      d.innerHTML = '<span>' + (r.winner ? '胜' : '负') + ' · ' + (r.mode === 'HOTSEAT' ? '热座' : '人机') +
        '</span><span class="' + (r.delta > 0 ? 'score-delta up' : 'score-delta down') + '">' +
        (r.delta > 0 ? '+' : '') + r.delta + '</span>';
      rec.appendChild(d);
    });
  }

  // ---------- 事件绑定 ----------
  bindSegmented('home-ai-count', function () {});
  bindSegmented('home-ai-level', function () {});
  bindSegmented('home-hot-count', function () {});

  $('btn-start-ai').addEventListener('click', function () {
    ensureAudio(); applySettings();
    startGame(Number($('home-ai-count').querySelector('.on').dataset.value),
      $('home-ai-level').querySelector('.on').dataset.value, false);
  });
  $('btn-start-hot').addEventListener('click', function () {
    ensureAudio(); applySettings();
    startGame(Number($('home-hot-count').querySelector('.on').dataset.value), 'NORMAL', true);
  });

  document.querySelectorAll('[data-go]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.go;
      if (target === 'stats') renderStats();
      showScreen(target);
    });
  });

  $('btn-quit').addEventListener('click', function () {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    showScreen('home');
  });
  $('btn-restart').addEventListener('click', function () { startGame(lastCount, lastLevel, hotseat); });
  $('btn-again').addEventListener('click', function () { startGame(lastCount, lastLevel, hotseat); });
  $('btn-result-home').addEventListener('click', function () { showScreen('home'); });

  $('btn-play').addEventListener('click', function () {
    if (!selected.length) { toast('请先选牌'); return; }
    var res = controller.play(game, activeSeat, selected);
    if (!res.ok) { toast(ERROR_TEXT[res.error] || '出牌失败'); return; }
    playPrompt(res.detected && engine.isBomb(res.detected) ? 'BOMB' : 'PLAY');
    afterAction(res);
  });
  $('btn-pass').addEventListener('click', function () {
    var res = controller.pass(game, activeSeat);
    if (!res.ok) { toast(ERROR_TEXT[res.error] || '不能不出'); return; }
    afterAction(res);
  });
  $('btn-hint').addEventListener('click', function () {
    var view = controller.getView(game, activeSeat);
    if (!view.legalPlays.length) { toast('没有能压的牌，请选择不出'); return; }
    selected = view.legalPlays[0].cards.map(function (c) { return c.id; });
    render();
    toast('已选中：' + view.legalPlays[0].detected.label);
  });
  $('btn-handoff').addEventListener('click', function () {
    $('handoff-mask').classList.remove('show');
    selected = [];
    render();
    playPrompt('YOUR_TURN');
  });

  function bindToggle(id, key, after) {
    $(id).addEventListener('click', function () {
      settings[key] = !settings[key];
      store.saveSettings(settings);
      $(id).setAttribute('aria-checked', settings[key] ? 'true' : 'false');
      if (after) after();
    });
  }
  bindToggle('toggle-bgm', 'bgm', function () { settings.bgm ? startBgm() : stopBgm(); });
  bindToggle('toggle-dialect', 'dialect', function () { if (settings.dialect) playPrompt('YOUR_TURN'); });
  bindToggle('toggle-font', 'largeFont', applySettings);
  $('btn-clear-records').addEventListener('click', function () {
    if (!window.confirm('确定清空本机战绩？此操作不可撤销。')) return;
    store.clearAll();
    settings = store.getSettings();
    applySettings();
    renderStats();
    toast('已清空');
  });

  var rulesBox = $('rule-types');
  RULES.forEach(function (r) {
    var d = document.createElement('div');
    d.className = 'rule-item';
    d.innerHTML = '<b>' + r[0] + '</b><br>' + r[1];
    rulesBox.appendChild(d);
  });

  window.addEventListener('resize', drawBoard);
  if (window.FX) window.FX.init($('fx-canvas'));
  applySettings();
  showScreen('home');
})();
