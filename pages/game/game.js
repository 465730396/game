'use strict';

var app = getApp();
var SBM = app.globalData.SBM;
var engine = SBM.engine;
var controller = SBM.controller;
var audio = require('../../utils/audio.js');
var fx = require('../../utils/fx.js');

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
// [DESIGN 2026-11-18] AI 人格化：座位名与触发台词。旧版是"AI 1/2/3"，对局像在做题。
var AI_NAMES = ['老支书', '二娃', '秀兰'];
var AI_LINES = {
  PLAY: ['该我了吧', '这牌得跟', '走一个', '接上'],
  BOMB: ['炸了！', '这手你接不住', '别怪我'],
  PASS: ['我不要', '过', '你先来'],
  DECLARE: ['我就剩一张了啊', '报牌了，小心点']
};

function pickLine(kind) {
  var arr = AI_LINES[kind] || AI_LINES.PLAY;
  return arr[Math.floor(Math.random() * arr.length)];
}

function rankOrder(rank) {
  var order = engine.RANKS;
  var i = order.indexOf(rank);
  return i < 0 ? 99 : i;
}

function cardVM(c, selected) {
  return {
    id: c.id, rank: c.rank, suitText: SUIT_TEXT[c.suit] || '',
    red: c.suit === 'H' || c.suit === 'D', selected: !!selected
  };
}

Page({
  data: {
    gameMeta: '', seats: [], lastCards: [], playLabel: '',
    forceText: '', declaredText: '', statusText: '', hand: [], handTitle: '我的手牌',
    canPlay: false, canPass: false, canHint: false, passEmphasis: false,
    handoff: false, handoffName: '', largeFont: false,
    roundText: '', passReason: '', counter: [], guide: false,
    playPulse: false, shake: false, pulseDir: ''
  },

  onLoad: function (query) {
    this.setData({ largeFont: app.getSettings().largeFont !== false });
    this.fx = fx.createFX(this, '#fx');
    this.selected = [];
    this.aiTimer = null;
    this.audioOn = false;
    this.mode = query.mode || 'AI';
    this.level = query.level || 'NORMAL';
    this.count = Number(query.count) || 3;
    this.resuming = query.resume === '1';
    // [DESIGN 2026-11-18] 规则档：简化档关闭 4 条强制出牌规则，降低新手首局挫败感。
    var st0 = app.getSettings();
    this.ruleMode = query.rule === 'SIMPLE' ? 'SIMPLE'
      : (query.rule === 'CLASSIC' ? 'CLASSIC' : (st0.ruleMode || 'CLASSIC'));
    // 一轮 5 局累计积分
    this.roundSize = 5;
    this.roundIndex = 1;
    this.totals = {};
    this.lines = {};

    var game;
    if (this.resuming) {
      var s = app.getSession();
      // 仅续玩未完成且结构完整的对局，否则回退到新开一局
      if (s && s.game && s.game.status === 'PLAYING' && s.game.players && s.game.players.length) {
        game = s.game;
        this.mode = s.mode; this.level = s.level; this.count = s.count;
        this.hotseat = !!s.hotseat; this.activeSeat = s.activeSeat || game.currentSeat;
        // 续局要把轮次进度一起恢复，否则累计分会从第 1 局重算
        this.roundIndex = s.roundIndex || 1;
        this.totals = s.roundTotals || {};
        if (s.ruleMode) this.ruleMode = s.ruleMode;
      } else {
        app.clearSession();
      }
    }
    if (!game) {
      this.hotseat = this.mode === 'HOTSEAT';
      // 从结算页"下一局"进来时沿用上一轮累计；否则开新一轮（并清掉可能残留的旧轮次）
      var rs = query.round === '1' ? app.getRound() : null;
      if (rs && rs.mode === this.mode && rs.count === this.count && rs.index) {
        this.roundIndex = rs.index;
        this.totals = rs.totals || {};
      } else {
        app.clearRound();
      }
      game = this.createGame();
      this.activeSeat = game.currentSeat;
    }
    this.game = game;
    if (this.activeSeat === undefined) this.activeSeat = game.currentSeat;
    // 续局的热座对局：默认显示交接遮罩，避免上一位玩家手牌直接暴露
    if (this.resuming && this.hotseat) this.setData({ handoff: true, handoffName: game.players[this.activeSeat].name });

    audio.init();
    var st = app.getSettings();
    if (st.bgm) audio.startBgm(true);
    audio.vibrate();
    this.finished = false;
    // [DESIGN 2026-11-18] 首局引导：只在第一次进牌桌时出现一次，讲清"红桃3先出"与强制规则。
    // 热座续局时已有交接遮罩，不再叠加引导，避免两层蒙版。
    var guided = false;
    try { guided = !!wx.getStorageSync('sbm_guided'); } catch (e) {}
    this.setData({ guide: !guided && !this.data.handoff });
    // [RELEASE 2026-11-18] 首手自动选中红桃3，省去玩家在 16~24 张牌里找牌；同时立即存快照，
    // 避免"看到手牌但没出牌就退出"时续局入口消失。
    this.autoSelectFirstHand();
    this.saveSnapshot();
  },

  onGuideClose: function () {
    try { wx.setStorageSync('sbm_guided', 1); } catch (e) {}
    this.setData({ guide: false });
    audio.vibrate();
  },

  // 首次出牌必须包含红桃3：若当前该真人出牌，先把红桃3选上（玩家仍可增删）。
  autoSelectFirstHand: function () {
    var g = this.game;
    if (!g || g.firstHandDone) return;
    var p = g.players[this.activeSeat];
    if (!p || p.isAI || g.currentSeat !== this.activeSeat) return;
    var h3 = p.hand.filter(function (c) { return c.id === 'H3'; })[0];
    if (h3) this.selected = [h3.id];
  },

  onReady: function () { try { this.fx.mount(); } catch (e) {} },

  onShow: function () {
    var st = app.getSettings();
    if (st.bgm) audio.resume(); else audio.stopBgm();
    if (this.game) {
      this.render();
      // 续局/切后台回来时，若当前轮到 AI，恢复 AI 调度
      if (this.game.status === 'PLAYING') this.scheduleAI();
    }
  },

  onHide: function () {
    this.clearAiTimer();
    audio.suspend();
    this.fx.stop();
    this.saveSnapshot();
  },

  onUnload: function () {
    this.clearAiTimer();
    audio.suspend();
    this.fx.stop();
    // [RELEASE 2026-11-18] 系统返回键离开牌桌时也保留对局，保证"继续对局"入口可用。
    if (this.game && this.game.status === 'PLAYING') this.saveSnapshot();
  },

  onShareAppMessage: function () {
    return { title: '陕北捉老麻 · 来一局？', path: '/pages/index/index' };
  },

  createGame: function () {
    var difficulties = [this.level, this.level, this.level, this.level];
    var names = [];
    for (var i = 0; i < this.count; i++) {
      // [DESIGN 2026-11-18] 人机模式给 AI 起地方味名字，替代"AI 1/2/3"，对手有身份后对局才不像做题。
      names.push(this.hotseat ? ('玩家 ' + (i + 1)) : (i === 0 ? '我' : AI_NAMES[(i - 1) % AI_NAMES.length]));
    }
    var g = controller.createGame({
      playerCount: this.count, difficulties: difficulties, names: names, ruleMode: this.ruleMode
    });
    if (this.hotseat) g.players.forEach(function (p) { p.isAI = false; });
    return g;
  },

  clearAiTimer: function () {
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
  },

  saveSnapshot: function () {
    if (!this.game || this.game.status !== 'PLAYING') return;
    app.saveSession({
      game: this.game, mode: this.mode, level: this.level, count: this.count,
      hotseat: this.hotseat, activeSeat: this.activeSeat, savedAt: Date.now(),
      // 轮次进度随快照一起存，续局才能接着第 N 局打
      roundIndex: this.roundIndex, roundTotals: this.totals, ruleMode: this.ruleMode
    });
  },

  // 记牌器：每个点数还有多少张没出现（已出的 + 我手上的都算"已知"）
  buildCounter: function (view) {
    var total = {};
    engine.createDeck(view.config).forEach(function (c) { total[c.rank] = (total[c.rank] || 0) + 1; });
    var gone = {};
    (view.public.playedCards || []).forEach(function (c) { gone[c.rank] = (gone[c.rank] || 0) + 1; });
    view.hand.forEach(function (c) { gone[c.rank] = (gone[c.rank] || 0) + 1; });
    var out = [];
    engine.RANKS.forEach(function (r) {
      var left = (total[r] || 0) - (gone[r] || 0);
      if (total[r] && left > 0) out.push({ rank: r, left: left });
    });
    return out;
  },

  render: function () {
    var g = this.game;
    if (!g) return;
    var view = controller.getView(g, this.activeSeat);
    var hidden = this.hotseat && this.data.handoff;

    var now = Date.now();
    var seats = g.players.map(function (p, i) {
      var line = this.lines[i];
      return {
        seat: i, name: p.name, count: p.hand.length,
        active: i === view.public.currentSeat,
        declared: view.public.declaredCounts[i] || 0,
        // [DESIGN 2026-11-18] 标出"上一手是谁出的"与"只剩一张"的危险状态
        last: !!(view.public.lastPlay && view.public.lastPlay.seat === i),
        danger: p.hand.length === 1,
        line: line && (now - line.ts < 2200) ? line.text : ''
      };
    }, this);

    var last = view.public.lastPlay;
    var lastCards = last && last.cards.length ? last.cards.map(function (c) { return cardVM(c, false); }) : [];
    var playLabel = last && last.cards.length
      ? (g.players[last.seat].name + ' 出 · ' + (last.detected.label || ''))
      : '新一轮 · 自由出牌';

    // [DESIGN 2026-11-18] 手牌按点数排序：发牌顺序是随机的，不排序时玩家要在 16~24 张里找牌。
    var hand = view.hand.slice().sort(function (a, b) {
      return rankOrder(a.rank) - rankOrder(b.rank) || (a.suit > b.suit ? 1 : -1);
    }).map(function (c) {
      return cardVM(c, this.selected.indexOf(c.id) >= 0);
    }, this);

    var myTurn = !hidden && view.public.currentSeat === this.activeSeat;
    // [RELEASE 2026-11-18] 状态行覆盖三种真实处境：等别人、无牌可压、首手限制。
    // 旧实现"无牌可压"时仍显示"轮到你出牌"，玩家会盯着灰掉的出牌键不知道要按"不出"。
    var st;
    if (hidden) {
      st = '请交接设备';
    } else if (!myTurn) {
      st = this.hotseat ? ('轮到 ' + g.players[view.public.currentSeat].name)
        : (g.players[view.public.currentSeat].name + ' 思考中…');
    } else if (!view.legalPlays.length) {
      st = view.canPass ? '无牌可压，请点「不出」' : '轮到你出牌';
    } else if (!g.firstHandDone) {
      st = '第一手必须包含红桃3';
    } else {
      st = this.hotseat ? ('轮到 ' + g.players[this.activeSeat].name + ' 出牌') : '轮到你出牌';
    }

    // 报牌提示：只在剩余 1~3 张时出现（引擎已过滤 0）
    var dc = view.public.declaredCounts;
    var declaredText = Object.keys(dc).filter(function (k) { return dc[k] > 0; })
      .map(function (k) { return g.players[k].name + ' 报牌 ' + dc[k] + ' 张'; }).join(' · ');

    // [DESIGN 2026-11-18] 有人只剩一张时给出预警，这是牌局最紧张的时刻，旧版完全静态。
    var dangerNames = g.players.filter(function (p, i) {
      return i !== view.public.currentSeat && p.hand.length === 1;
    }).map(function (p) { return p.name; });
    if (!hidden && dangerNames.length) st += ' · ' + dangerNames.join('、') + ' 只剩一张';

    // [DESIGN 2026-11-18] "不出"被禁用时给出原因，玩家不会盯着灰按钮不知道该怎么办。
    var passReason = '';
    if (!hidden && myTurn && !view.canPass) {
      if (!view.public.lastPlay) passReason = '你是领出者，必须先出牌';
      else if (view.public.forceFlags.length) {
        passReason = '必须按规则出牌：' + view.public.forceFlags.map(function (f) { return FLAG_TEXT[f] || f; }).join('、');
      } else passReason = '这一手你必须出牌';
    }

    var seatForTotal = this.hotseat ? this.activeSeat : 0;
    var myTotal = this.totals[seatForTotal] || 0;
    var roundText = '第 ' + this.roundIndex + ' / ' + this.roundSize + ' 局' +
      (myTotal ? ' · 累计 ' + (myTotal > 0 ? '+' : '') + myTotal : '');

    this.setData({
      gameMeta: (g.players.length + ' 人 · ') + (this.hotseat ? '同屏热座' :
        ({ EASY: '简单', NORMAL: '普通', HARD: '困难' }[this.level] || this.level)) +
        (this.ruleMode === 'SIMPLE' ? ' · 简化' : ''),
      seats: seats,
      lastCards: lastCards,
      playLabel: playLabel,
      forceText: hidden ? '' : view.public.forceFlags.map(function (f) { return FLAG_TEXT[f] || f; }).join(' · '),
      declaredText: hidden ? '' : declaredText,
      statusText: st,
      hand: hand,
      handTitle: hidden ? '手牌已遮挡' : (this.hotseat ? g.players[this.activeSeat].name + ' 的手牌' : '我的手牌'),
      canPlay: myTurn && view.legalPlays.length > 0 && this.selected.length > 0,
      canPass: myTurn && view.canPass,
      // 无牌可压时把"不出"做成唯一可点的动作，视觉上引导过去
      passEmphasis: myTurn && view.canPass && view.legalPlays.length === 0,
      canHint: myTurn && view.legalPlays.length > 0,
      roundText: hidden ? '' : roundText,
      passReason: passReason,
      counter: hidden ? [] : this.buildCounter(view)
    });

    if (!hidden && !this.hotseat && view.public.currentSeat === 0 && this.lastSeat !== 0) {
      audio.prompt('YOUR_TURN');
    }
    this.lastSeat = view.public.currentSeat;
  },

  onCardTap: function (e) {
    if (this.data.handoff) return;
    // [RELEASE 2026-11-18] 非本人回合点牌不再静默无反应，给出明确提示，避免"点了没反应"的困惑。
    var view = controller.getView(this.game, this.activeSeat);
    if (view.public.currentSeat !== this.activeSeat) {
      wx.showToast({ title: this.game.players[view.public.currentSeat].name + ' 出牌中', icon: 'none' });
      return;
    }
    var id = e.currentTarget.dataset.id;
    var i = this.selected.indexOf(id);
    if (i >= 0) this.selected.splice(i, 1); else this.selected.push(id);
    this.render();
  },

  onPlay: function () {
    if (!this.selected.length) { wx.showToast({ title: '请先选牌', icon: 'none' }); return; }
    var res = controller.play(this.game, this.activeSeat, this.selected);
    if (!res.ok) { this.explainError(res.error); return; }
    var bomb = !!(res.detected && engine.isBomb(res.detected));
    audio.prompt(bomb ? 'BOMB' : 'PLAY');
    this.flashPlay(bomb);
    this.afterAction(res);
  },

  // [DESIGN 2026-11-18] 被强制规则拦住时，不能只说"按规则必须出牌"，
  // 要直接告诉玩家是哪条规则、必须出什么，否则新手只会觉得"游戏坏了"。
  explainError: function (code) {
    if (code === 'FORCED_TO_PLAY') {
      var view = controller.getView(this.game, this.activeSeat);
      var txt = view.public.forceFlags.map(function (f) { return FLAG_TEXT[f] || f; }).join('、');
      wx.showToast({ title: txt ? (txt + '，必须按规则出') : '按规则必须出牌', icon: 'none' });
      return;
    }
    wx.showToast({ title: ERROR_TEXT[code] || '出牌失败', icon: 'none' });
  },

  // 出牌反馈：出牌区弹一下；炸弹/天炸全屏震动 + 重触感
  flashPlay: function (bomb) {
    var self = this;
    this.setData({ playPulse: false });
    setTimeout(function () {
      self.setData({ playPulse: true, shake: !!bomb });
      setTimeout(function () { self.setData({ playPulse: false, shake: false }); }, bomb ? 520 : 260);
    }, 16);
    if (bomb) audio.vibrate('heavy');
  },

  onPass: function () {
    var res = controller.pass(this.game, this.activeSeat);
    if (!res.ok) { wx.showToast({ title: ERROR_TEXT[res.error] || '不能不出', icon: 'none' }); return; }
    this.afterAction(res);
  },

  onHint: function () {
    var view = controller.getView(this.game, this.activeSeat);
    if (!view.legalPlays.length) { wx.showToast({ title: '没有能压的牌，请点「不出」', icon: 'none' }); return; }
    this.selected = view.legalPlays[0].cards.map(function (c) { return c.id; });
    this.render();
    wx.showToast({ title: '已选中：' + view.legalPlays[0].detected.label, icon: 'none' });
  },

  afterAction: function (result) {
    this.selected = [];
    // 有人报到一张时补一句台词，制造最后的紧张感
    if (!this.hotseat) {
      var self = this;
      this.game.players.forEach(function (p, i) {
        if (p.isAI && p.hand.length === 1 && !self.lines[i]) self.setLine(i, 'DECLARE');
      });
    }
    if (this.hotseat && !result.finished && this.game.status === 'PLAYING') {
      this.activeSeat = this.game.currentSeat;
      this.setData({ handoff: true, handoffName: this.game.players[this.activeSeat].name });
    }
    if (result.finished) { this.finishGame(); return; }
    this.render();
    this.saveSnapshot();
    this.scheduleAI();
  },

  onHandoff: function () {
    this.setData({ handoff: false });
    this.selected = [];
    this.render();
    audio.prompt('YOUR_TURN');
  },

  setLine: function (seat, kind) {
    this.lines[seat] = { text: pickLine(kind), ts: Date.now() };
  },

  scheduleAI: function () {
    this.clearAiTimer();
    if (!this.game || this.hotseat || this.game.status !== 'PLAYING') return;
    var seat = this.game.currentSeat;
    if (seat === 0 || !this.game.players[seat].isAI) return;
    var self = this;
    this.aiTimer = setTimeout(function () {
      self.aiTimer = null;
      var res = controller.aiTakeTurn(self.game);
      if (res.action === 'PASS') {
        self.setLine(seat, 'PASS');
      } else if (res.ok) {
        var bomb = !!(res.detected && engine.isBomb(res.detected));
        self.setLine(seat, bomb ? 'BOMB' : 'PLAY');
        self.flashPlay(bomb);
      } else {
        controller.pass(self.game, seat);
        self.setLine(seat, 'PASS');
      }
      if (self.game.status === 'FINISHED') { self.finishGame(); return; }
      self.render();
      self.saveSnapshot();
      self.scheduleAI();
    }, 620);
  },

  finishGame: function () {
    // [RELEASE 2026-11-18] 防重复结算：AI 定时器与出牌回调都可能触发，重复执行会重复写战绩。
    if (this.finished) return;
    this.finished = true;
    this.clearAiTimer();
    app.clearSession();
    var g = this.game;
    var s = g && g.settlement;
    if (!g || !s) { wx.reLaunch({ url: '/pages/index/index' }); return; }
    var won = g.winnerSeat === 0;

    s.scores.forEach(function (row) {
      if (!this.hotseat && row.seat !== 0) return;
      SBM.store.addRecord({
        name: row.name, mode: this.hotseat ? 'HOTSEAT' : 'AI', delta: row.delta, rank: row.rank,
        winner: row.seat === g.winnerSeat, ruleSetId: g.config.ruleSetId, createdAt: Date.now()
      });
    }, this);
    if (this.hotseat) SBM.store.updateStats(false, 0);
    else {
      var human = s.scores.filter(function (x) { return x.seat === 0; })[0];
      SBM.store.updateStats(won, human.delta);
    }
    audio.prompt(won ? 'YOUR_TURN' : 'PLAY');
    this.fx.celebrate();

    // [DESIGN 2026-11-18] 一轮多局：把本局 delta 累加进轮次总分，结算页展示"第 N/5 局"与累计榜。
    var totals = {};
    for (var k in this.totals) totals[k] = this.totals[k];
    s.scores.forEach(function (row) { totals[row.seat] = (totals[row.seat] || 0) + row.delta; });
    var roundDone = this.roundIndex >= this.roundSize;
    var roundList = s.scores.slice().sort(function (a, b) { return a.seat - b.seat; }).map(function (row) {
      return { seat: row.seat, name: row.name, total: totals[row.seat] || 0 };
    });
    if (roundDone) app.clearRound();
    else {
      app.saveRound({
        index: this.roundIndex + 1, size: this.roundSize, totals: totals,
        mode: this.mode, count: this.count, level: this.level
      });
    }

    // 结算数据存全局，结算页读取
    app.globalData.lastResult = {
      scores: s.scores.slice().sort(function (a, b) { return a.rank - b.rank; }),
      winnerName: g.players[g.winnerSeat].name,
      winnerSeat: g.winnerSeat,
      won: won, hotseat: this.hotseat,
      // 炸弹倍率与轮次进度
      multiplier: s.multiplier || 1, bombPoints: s.bombPoints || 0,
      round: { index: this.roundIndex, size: this.roundSize, done: roundDone, totals: roundList },
      // [RELEASE 2026-11-18] 记录本局参数，"再来一局"沿用原模式/人数/难度，不再回落成 3 人普通。
      mode: this.mode, level: this.level, count: this.count,
      ruleSetId: g.config.ruleSetId,
      time: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    };
    var self = this;
    setTimeout(function () {
      wx.redirectTo({ url: '/pages/result/result' });
    }, 500);
  },

  onRestart: function () {
    var self = this;
    wx.showModal({
      title: '重新开始',
      content: '放弃当前这局，重新发牌？',
      success: function (r) {
        if (!r.confirm) return;
        self.clearAiTimer();
        self.finished = false;
        self.game = self.createGame();
        self.activeSeat = self.game.currentSeat;
        self.selected = [];
        self.lastSeat = null;
        self.lines = {};
        // 热座重开同样要交接设备，避免上一位玩家的视线残留
        self.setData({
          handoff: !!self.hotseat,
          handoffName: self.hotseat ? self.game.players[self.activeSeat].name : ''
        });
        self.autoSelectFirstHand();
        self.render();
        self.saveSnapshot();
        self.scheduleAI();
      }
    });
  },

  // [RELEASE 2026-11-18] 主动退出：补上此前完全缺失的出口。
  // 规则承诺"逃跑只记次数不计分"，此处按承诺记一次逃跑并放弃本局。
  onExit: function () {
    var self = this;
    if (!this.game || this.game.status !== 'PLAYING') {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    wx.showModal({
      title: '退出对局',
      content: '退出将记为一次逃跑（只记次数、不计分），并放弃当前这局。',
      confirmText: '退出',
      cancelText: '继续打',
      success: function (r) {
        if (!r.confirm) return;
        self.clearAiTimer();
        app.recordEscape();
        app.clearRound();   // 中途逃跑视为放弃本轮，避免下次开局接着用旧的累计分
        self.game = null;   // 阻止 onUnload 重新写入快照
        wx.reLaunch({ url: '/pages/index/index' });
      }
    });
  }
});
