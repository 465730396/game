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
// [DESIGN 2026-11-19] 强制规则的"正经解释"。实测 74% 的对局里玩家至少撞上一次
// "想不出但不让不出"，底部一行小字说不清"凭什么我必须出"，挫败感由此而来。
// 每条规则第一次拦住玩家时用弹窗讲一遍，之后只留底部提示，不重复打扰。
var FORCE_DETAIL = {
  NEED_A: '本地规矩：上家出单张 K，你手上只要有 A 就必须压，不能留着不出。手上没有 A 才可以过。',
  NEED_PAIR_A: '本地规矩：上家出对子 K，你手上有对 A 就必须压。没有对 A 才可以过。',
  NEED_2: '本地规矩：上家出 A，你手上有 2 就必须压。没有 2 才可以过。',
  NEED_BOMB: '本地规矩：上家出 2，你手上有炸弹就必须炸。没有炸弹才可以过。'
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
    // [FIX 2026-11-19] 结算跳转是延迟 500ms 的，页面卸载不会自动清定时器。
    // 用 alive 标记 + redirectTimer 句柄双保险，见 finishGame / onUnload。
    this.alive = true;
    this.redirected = false;
    this.redirectTimer = null;
    this.audioOn = false;
    this.mode = query.mode || 'AI';
    this.level = query.level || 'NORMAL';
    this.count = Number(query.count) || 3;
    this.resuming = query.resume === '1';
    // [DESIGN 2026-11-19] 每日挑战：以当天日期为 seed，全服同一副牌，单局制。
    // 不需要后端就能做出"同一天大家打同一局"的对比场景，是当前结构下最便宜的留存钩子。
    this.daily = query.daily === '1';
    this.dailyDate = '';
    this.dailySeed = 0;
    if (this.daily) {
      var now = new Date();
      var mm = ('0' + (now.getMonth() + 1)).slice(-2);
      var dd = ('0' + now.getDate()).slice(-2);
      this.dailyDate = now.getFullYear() + '-' + mm + '-' + dd;
      this.dailySeed = Number('' + now.getFullYear() + mm + dd);
      this.count = 3;
      this.level = 'NORMAL';
      this.ruleMode = 'CLASSIC';
    }
    // [DESIGN 2026-11-18] 规则档：简化档关闭 4 条强制出牌规则，降低新手首局挫败感。
    var st0 = app.getSettings();
    if (!this.daily) {
      this.ruleMode = query.rule === 'SIMPLE' ? 'SIMPLE'
        : (query.rule === 'CLASSIC' ? 'CLASSIC' : (st0.ruleMode || 'CLASSIC'));
    }
    // 一轮 5 局累计积分；每日挑战是单局
    this.roundSize = this.daily ? 1 : 5;
    this.roundIndex = 1;
    this.totals = {};
    this.roundHistory = [];
    this.lines = {};

    var game;
    if (this.resuming) {
      var s = app.getSession();
      // 仅续玩未完成且结构完整的对局，否则回退到新开一局
      if (s && s.game && s.game.status === 'PLAYING' && s.game.players && s.game.players.length) {
        game = s.game;
        this.mode = s.mode; this.level = s.level; this.count = s.count;
        this.hotseat = !!s.hotseat;
        // 快照已由 app.getSession 校验过结构，这里只做越界兜底
        var as = Number(s.activeSeat);
        this.activeSeat = (as >= 0 && as < game.players.length) ? as : game.currentSeat;
        // 续局要把轮次进度一起恢复，否则累计分会从第 1 局重算
        this.roundIndex = s.roundIndex || 1;
        this.totals = s.roundTotals || {};
        this.roundHistory = s.roundHistory || [];
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
        this.roundHistory = rs.history || [];
      } else if (!this.daily) {
        // 每日挑战是独立入口，不能顺手清掉用户正在进行的轮次进度
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
    // onHide 会停掉特效帧循环，回前台要显式恢复，否则背景永远定格在切走那一刻
    if (this.fx) this.fx.start();
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
    // [FIX 2026-11-19] 先置 alive=false 再清定时器：结算页跳转、AI 推进都必须立刻停。
    this.alive = false;
    this.clearRedirect();
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
    var opt = { playerCount: this.count, difficulties: difficulties, names: names, ruleMode: this.ruleMode };
    // 每日挑战：固定 seed，全服同一副牌
    if (this.daily) opt.seed = this.dailySeed;
    // [DESIGN 2026-11-19] 轮次内从第 2 局起由上一局末位先出，首局仍按红桃3。
    // 注意：每局红桃 3 独立随机，先手优势不会累积到同一人，这里的目的不是消除优势，
    // 而是给落后方一次起手补偿，让一轮之内真的有翻盘窗口。
    if (!this.daily && this.roundIndex > 1) {
      var rd = app.getRound();
      if (rd && typeof rd.nextFirstSeat === 'number' && rd.nextFirstSeat < this.count) {
        opt.firstSeat = rd.nextFirstSeat;
      }
    }
    var g = controller.createGame(opt);
    if (this.hotseat) g.players.forEach(function (p) { p.isAI = false; });
    return g;
  },

  clearAiTimer: function () {
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
  },

  // [FIX 2026-11-19] 结算跳转句柄。重开 / 退出 / 卸载都必须能取消它，
  // 否则会出现"人手一离开，首页被结算页顶掉"或"新局刚发牌就被踢去结算"。
  clearRedirect: function () {
    if (this.redirectTimer) { clearTimeout(this.redirectTimer); this.redirectTimer = null; }
  },

  saveSnapshot: function () {
    if (!this.game || this.game.status !== 'PLAYING') return;
    // 每日挑战不写续局快照：否则玩家在轮次中途点挑战，会把原有的未完成对局覆盖掉
    if (this.daily) return;
    app.saveSession({
      game: this.game, mode: this.mode, level: this.level, count: this.count,
      hotseat: this.hotseat, activeSeat: this.activeSeat, savedAt: Date.now(),
      // 轮次进度随快照一起存，续局才能接着第 N 局打
      roundIndex: this.roundIndex, roundTotals: this.totals, ruleMode: this.ruleMode,
      roundHistory: this.roundHistory
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
    // 每日挑战是单局制，显示"第 1/1 局"很怪，直接标成挑战
    var roundText = this.daily ? '每日挑战' : ('第 ' + this.roundIndex + ' / ' + this.roundSize + ' 局' +
      (myTotal ? ' · 累计 ' + (myTotal > 0 ? '+' : '') + myTotal : ''));

    this.setData({
      gameMeta: (this.daily ? '每日挑战 · ' : '') + (g.players.length + ' 人 · ') + (this.hotseat ? '同屏热座' :
        ({ EASY: '简单', NORMAL: '普通', HARD: '困难' }[this.level] || this.level)) +
        (this.ruleMode === 'SIMPLE' ? ' · 简化' : ''),
      seats: seats,
      lastCards: lastCards,
      playLabel: playLabel,
      forceText: hidden ? '' : view.public.forceFlags.map(function (f) { return FLAG_TEXT[f] || f; }).join(' · '),
      declaredText: hidden ? '' : declaredText,
      statusText: st,
      // [FIX 2026-11-19] 交接遮罩期间不再把真实手牌下发给视图层。旧实现只是"盖住"，
      // 手牌数据仍在渲染树里；遮罩 rgba 0.92 仍有 8% 透光，加上遮罩本身依赖 setData
      // 时序，等于把"别偷看"完全押在一层贴图上。现在数据层面直接清空。
      hand: hidden ? [] : hand,
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
    // [FIX 2026-11-19] 遮罩是唯一视觉防线，逻辑层必须再挡一次，
    // 否则遮罩一帧延迟或点击穿透就能替下家出牌。
    if (this.data.handoff) return;
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
    if (this.data.handoff) return;
    var res = controller.pass(this.game, this.activeSeat);
    if (!res.ok) {
      // 被强制规则拦住时，第一次讲清楚"凭什么我必须出"
      if (res.error === 'FORCED_TO_PLAY') { this.explainForce(); return; }
      wx.showToast({ title: ERROR_TEXT[res.error] || '不能不出', icon: 'none' });
      return;
    }
    this.afterAction(res);
  },

  // [DESIGN 2026-11-19] 强制规则一次性教学：每条规则只在第一次拦住玩家时弹窗，
  // 之后退化为底部小字提示。既解释了规则，又不会每局重复打扰。
  explainForce: function () {
    var view = controller.getView(this.game, this.activeSeat);
    var flags = (view.public.forceFlags || []).filter(function (f) { return !!FLAG_TEXT[f]; });
    if (!flags.length) { wx.showToast({ title: '这一手不能不出', icon: 'none' }); return; }
    var flag = flags[0];
    var seen = [];
    try { seen = wx.getStorageSync('sbm_forcetip') || []; } catch (e) {}
    if (!Array.isArray(seen)) seen = [];
    if (seen.indexOf(flag) >= 0) {
      wx.showToast({ title: '必须' + FLAG_TEXT[flag], icon: 'none' });
      return;
    }
    seen.push(flag);
    try { wx.setStorageSync('sbm_forcetip', seen); } catch (e) {}
    wx.showModal({
      title: '本地规矩',
      content: FORCE_DETAIL[flag] || FLAG_TEXT[flag],
      showCancel: false,
      confirmText: '知道了'
    });
  },

  onHint: function () {
    if (this.data.handoff) return;
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

    // [FIX 2026-11-19] 热座一局只写一条聚合记录。旧实现按座位各写一条（3~4 条），
    // 但 updateStats 只 +1 局，统计页于是出现"总局数 10 / 记录 32 条"且累计积分恒为 0；
    // 座位名还会污染个人排行榜。
    if (this.hotseat) {
      SBM.store.addRecord({
        name: '热座对局', mode: 'HOTSEAT', delta: 0, rank: 0, winner: false,
        ruleSetId: g.config.ruleSetId, createdAt: Date.now()
      });
      SBM.store.updateStats(false, 0);
    } else {
      var human = s.scores.filter(function (x) { return x.seat === 0; })[0];
      SBM.store.addRecord({
        name: human.name, mode: 'AI', delta: human.delta, rank: human.rank,
        winner: human.seat === g.winnerSeat, ruleSetId: g.config.ruleSetId, createdAt: Date.now()
      });
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
    // [DESIGN 2026-11-19] 逐局记录。旧实现轮次结束只给一个总分，玩家看不出那 20 多分的差距
    // 是哪一局丢的，输了也不知道输在哪。现在把每局自己的得分串起来展示。
    var myDelta = s.scores.filter(function (x) { return x.seat === 0; })[0].delta;
    var history = (this.roundHistory || []).concat([{
      no: this.roundIndex, delta: myDelta, winnerSeat: g.winnerSeat
    }]);
    // [DESIGN 2026-11-19] 下一局交给末位（名次最后）先出，避免先手运气在多局里滚雪球。
    var lastRow = s.scores.slice().sort(function (a, b) { return b.rank - a.rank; })[0];
    var nextFirstSeat = lastRow ? lastRow.seat : 0;
    // [FIX 2026-11-19] 每日挑战是独立单局，绝不能碰玩家进行中的轮次进度。
    // 旧实现在这里无条件 clearRound()（daily 时 roundSize=1，roundDone 恒为 true），
    // 与 onLoad 里"daily 不清轮次"的保护自相矛盾：玩家打一把挑战，5 局累计分就没了。
    if (!this.daily) {
      if (roundDone) app.clearRound();
      else {
        app.saveRound({
          index: this.roundIndex + 1, size: this.roundSize, totals: totals,
          mode: this.mode, count: this.count, level: this.level,
          nextFirstSeat: nextFirstSeat, history: history
        });
      }
    }
    // 每日挑战：同一天只保留最好的一次，可以重玩刷分
    if (this.daily) this.saveDaily(myDelta, won);

    // 结算数据存全局，结算页读取
    app.globalData.lastResult = {
      scores: s.scores.slice().sort(function (a, b) { return a.rank - b.rank; }),
      winnerName: g.players[g.winnerSeat].name,
      winnerSeat: g.winnerSeat,
      won: won, hotseat: this.hotseat,
      // 炸弹倍率与轮次进度
      multiplier: s.multiplier || 1, bombPoints: s.bombPoints || 0,
      round: { index: this.roundIndex, size: this.roundSize, done: roundDone, totals: roundList, history: history },
      // [RELEASE 2026-11-18] 记录本局参数，"再来一局"沿用原模式/人数/难度，不再回落成 3 人普通。
      mode: this.mode, level: this.level, count: this.count,
      daily: this.daily,
      ruleSetId: g.config.ruleSetId,
      time: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    };
    var self = this;
    this.clearRedirect();
    // [FIX 2026-11-19] 定时跳转必须能自证页面还在、且对局仍是刚结算的那一局。
    // 旧实现直接 redirectTo：玩家在 500ms 内返回首页，首页会被结算页顶掉；
    // 在 500ms 内点"重开"，新局刚发牌就会被踢去上一局的结算页。
    this.redirectTimer = setTimeout(function () {
      self.redirectTimer = null;
      if (!self.alive || self.redirected) return;
      if (!self.game || self.game.status !== 'FINISHED') return;
      self.redirected = true;
      wx.redirectTo({ url: '/pages/result/result' });
    }, 500);
  },

  // 每日挑战成绩：当天以第一次完成为准，之后重开只作练习
  saveDaily: function (delta, won) {
    var rec = { date: this.dailyDate, delta: delta, won: !!won, at: Date.now() };
    var prev = null;
    try { prev = wx.getStorageSync('sbm_daily') || null; } catch (e) {}
    // [FIX 2026-11-19] 旧实现"取当天最高分"，而重开沿用固定 seed（实测同一副牌、
    // 17 张手牌完全一致），等于允许无限试错直到打赢 —— "单局定胜负"直接失效。
    // 现在首次完成即锁定，重开不再写入，挑战的一次性张力才成立。
    if (!prev || prev.date !== rec.date) {
      try { wx.setStorageSync('sbm_daily', rec); } catch (e) {}
    }
  },

  onRestart: function () {
    var self = this;
    var finished = this.game && this.game.status === 'FINISHED';
    var msg = this.daily
      ? '重开为练习局，今日成绩已锁定、不会被覆盖。'
      : (finished ? '开新的一局？' : '放弃当前这局，重新发牌？');
    wx.showModal({
      title: '重新开始',
      content: msg,
      success: function (r) {
        if (!r.confirm) return;
        // [FIX 2026-11-19] 取消待执行的结算跳转，否则新局会被上一局的结算页顶掉
        self.clearRedirect();
        self.redirected = false;
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
        // 取消待执行的结算跳转，避免"已退出却仍被拽到结算页"
        self.clearRedirect();
        self.finished = true;
        self.clearAiTimer();
        app.recordEscape();
        app.clearRound();   // 中途逃跑视为放弃本轮，避免下次开局接着用旧的累计分
        self.game = null;   // 阻止 onUnload 重新写入快照
        wx.reLaunch({ url: '/pages/index/index' });
      }
    });
  }
});
