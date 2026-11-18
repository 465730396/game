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

function cardVM(c, selected) {
  return {
    id: c.id, rank: c.rank, suitText: SUIT_TEXT[c.suit] || '',
    red: c.suit === 'H' || c.suit === 'D', selected: !!selected
  };
}

Page({
  data: {
    gameMeta: '', seats: [], lastCards: [], playLabel: '',
    forceText: '', statusText: '', hand: [], handTitle: '我的手牌',
    canPlay: false, canPass: false, canHint: false,
    handoff: false, handoffName: '', largeFont: false
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

    var game;
    if (this.resuming) {
      var s = app.getSession();
      // 仅续玩未完成且结构完整的对局，否则回退到新开一局
      if (s && s.game && s.game.status === 'PLAYING' && s.game.players && s.game.players.length) {
        game = s.game;
        this.mode = s.mode; this.level = s.level; this.count = s.count;
        this.hotseat = !!s.hotseat; this.activeSeat = s.activeSeat || game.currentSeat;
      } else {
        app.clearSession();
      }
    }
    if (!game) {
      this.hotseat = this.mode === 'HOTSEAT';
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
  },

  onShareAppMessage: function () {
    return { title: '陕北捉老麻 · 来一局？', path: '/pages/index/index' };
  },

  createGame: function () {
    var difficulties = [this.level, this.level, this.level, this.level];
    var names = [];
    for (var i = 0; i < this.count; i++) {
      names.push(this.hotseat ? ('玩家 ' + (i + 1)) : (i === 0 ? '我' : 'AI ' + i));
    }
    var g = controller.createGame({ playerCount: this.count, difficulties: difficulties, names: names });
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
      hotseat: this.hotseat, activeSeat: this.activeSeat, savedAt: Date.now()
    });
  },

  render: function () {
    var g = this.game;
    if (!g) return;
    var view = controller.getView(g, this.activeSeat);
    var hidden = this.hotseat && this.data.handoff;

    var seats = g.players.map(function (p, i) {
      return {
        seat: i, name: p.name, count: p.hand.length,
        active: i === view.public.currentSeat,
        declared: view.public.declaredCounts[i] || 0
      };
    });

    var last = view.public.lastPlay;
    var lastCards = last && last.cards.length ? last.cards.map(function (c) { return cardVM(c, false); }) : [];
    var playLabel = last && last.cards.length
      ? (g.players[last.seat].name + ' 出 · ' + (last.detected.label || ''))
      : '新一轮 · 自由出牌';

    var hand = view.hand.map(function (c) {
      var si = this.selected.indexOf(c.id);
      return cardVM(c, si >= 0);
    }, this);

    var myTurn = !hidden && view.public.currentSeat === this.activeSeat;
    var st = hidden ? '请交接设备' :
      (this.hotseat ? '轮到 ' + g.players[view.public.currentSeat].name :
        (view.public.currentSeat === 0 ? '轮到你出牌' : g.players[view.public.currentSeat].name + ' 思考中…'));

    this.setData({
      gameMeta: (g.players.length + ' 人 · ') + (this.hotseat ? '同屏热座' :
        ({ EASY: '简单', NORMAL: '普通', HARD: '困难' }[this.level] || this.level)),
      seats: seats,
      lastCards: lastCards,
      playLabel: playLabel,
      forceText: hidden ? '' : view.public.forceFlags.map(function (f) { return FLAG_TEXT[f] || f; }).join(' · '),
      statusText: st,
      hand: hand,
      handTitle: hidden ? '手牌已遮挡' : (this.hotseat ? g.players[this.activeSeat].name + ' 的手牌' : '我的手牌'),
      canPlay: myTurn && view.legalPlays.length > 0 && this.selected.length > 0,
      canPass: myTurn && view.canPass,
      canHint: myTurn && view.legalPlays.length > 0
    });

    if (!hidden && !this.hotseat && view.public.currentSeat === 0 && this.lastSeat !== 0) {
      audio.prompt('YOUR_TURN');
    }
    this.lastSeat = view.public.currentSeat;
  },

  onCardTap: function (e) {
    var id = e.currentTarget.dataset.id;
    var i = this.selected.indexOf(id);
    if (i >= 0) this.selected.splice(i, 1); else this.selected.push(id);
    this.render();
  },

  onPlay: function () {
    if (!this.selected.length) { wx.showToast({ title: '请先选牌', icon: 'none' }); return; }
    var res = controller.play(this.game, this.activeSeat, this.selected);
    if (!res.ok) { wx.showToast({ title: ERROR_TEXT[res.error] || '出牌失败', icon: 'none' }); return; }
    audio.prompt(res.detected && engine.isBomb(res.detected) ? 'BOMB' : 'PLAY');
    if (engine.isBomb(res.detected)) audio.vibrate('heavy');
    this.afterAction(res);
  },

  onPass: function () {
    var res = controller.pass(this.game, this.activeSeat);
    if (!res.ok) { wx.showToast({ title: ERROR_TEXT[res.error] || '不能不出', icon: 'none' }); return; }
    this.afterAction(res);
  },

  onHint: function () {
    var view = controller.getView(this.game, this.activeSeat);
    if (!view.legalPlays.length) { wx.showToast({ title: '没有能压的牌，请选择不出', icon: 'none' }); return; }
    this.selected = view.legalPlays[0].cards.map(function (c) { return c.id; });
    this.render();
    wx.showToast({ title: '已选中：' + view.legalPlays[0].detected.label, icon: 'none' });
  },

  afterAction: function (result) {
    this.selected = [];
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

  scheduleAI: function () {
    this.clearAiTimer();
    if (!this.game || this.hotseat || this.game.status !== 'PLAYING') return;
    var seat = this.game.currentSeat;
    if (seat === 0 || !this.game.players[seat].isAI) return;
    var self = this;
    this.aiTimer = setTimeout(function () {
      self.aiTimer = null;
      var res = controller.aiTakeTurn(self.game);
      if (!res.ok) controller.pass(self.game, seat);
      if (self.game.status === 'FINISHED') { self.finishGame(); return; }
      self.render();
      self.saveSnapshot();
      self.scheduleAI();
    }, 620);
  },

  finishGame: function () {
    this.clearAiTimer();
    app.clearSession();
    var g = this.game;
    var s = g.settlement;
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

    // 结算数据存全局，结算页读取
    app.globalData.lastResult = {
      scores: s.scores.slice().sort(function (a, b) { return a.rank - b.rank; }),
      winnerName: g.players[g.winnerSeat].name,
      won: won, hotseat: this.hotseat,
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
        self.game = self.createGame();
        self.activeSeat = self.game.currentSeat;
        self.selected = [];
        self.lastSeat = null;
        self.setData({ handoff: false });
        self.render();
        self.saveSnapshot();
        self.scheduleAI();
      }
    });
  }
});
