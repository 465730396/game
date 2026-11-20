'use strict';

var app = getApp();
var SBM = app.globalData.SBM;
var audio = require('../../utils/audio.js');

Page({
  data: {
    largeFont: false,
    // [FIX 2026-11-19] 2 人场暂时下线：同一副 48 张牌，2 人局每人 24 张，牌宽 92rpx 时一屏只能放 7 张，
    // 找一张牌要横滑 4 屏，实际不可玩。要压到 17 张就得继续从牌堆里删牌，
    // 而牌堆只剩 1 张 2、3 张 A，"见 A 必出 2""见 2 必出炸弹"两条规则的稀缺前提会被一起破坏。
    // 引擎仍支持 2 人，等手牌两行布局做完再放开。
    counts: [3, 4],
    levels: [{ value: 'EASY', label: '简单' }, { value: 'NORMAL', label: '普通' }, { value: 'HARD', label: '困难' }],
    aiCount: 3,
    aiLevel: 'NORMAL',
    hotCount: 3,
    ruleMode: 'CLASSIC',
    rules: [{ value: 'CLASSIC', label: '经典规则' }, { value: 'SIMPLE', label: '简化规则' }],
    hasSession: false,
    sessionDesc: '',
    dailyDone: false,
    dailyDesc: '',
    // [UI 2026-11-19] 品牌区右侧的胜率与每日挑战的日期块需要现算，避免在 WXML 里做运算
    statRate: 0,
    statGames: 0,
    dayNum: '',
    monthNum: ''
  },

  todayStr: function () {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  },

  onShow: function () {
    audio.init();
    var st = app.getSettings();
    var s = app.getSession();
    // 快照可能因旧版本/异常写入而不完整，逐层校验，避免 s.game 缺失时直接抛错白屏
    var alive = !!(s && s.game && s.game.players && s.game.players.length && s.game.status === 'PLAYING');
    // [DESIGN 2026-11-19] 每日挑战：当天 seed 固定，全服同一副牌；成绩本地留存，可重玩刷新。
    var daily = null;
    try { daily = wx.getStorageSync('sbm_daily') || null; } catch (e) {}
    var doneToday = !!(daily && daily.date === this.todayStr());
    var st2 = SBM.store.getStats();
    // [FIX 2026-11-19] 逃跑会 +1 总局数（保证"逃跑记一局"的口径），但它不该拉低胜率：
    // 旧算法 wins/games 让"开局就退"也变成一负，胜率越玩越低。分母改成"真正打完的局数"。
    var played = Math.max(0, (st2.games || 0) - (st2.escapes || 0));
    var rate = played ? Math.round((st2.wins / played) * 100) : 0;
    var now = new Date();
    this.setData({
      largeFont: st.largeFont !== false,
      ruleMode: st.ruleMode === 'SIMPLE' ? 'SIMPLE' : 'CLASSIC',
      hasSession: alive,
      sessionDesc: alive ? this.buildSessionDesc(s) : '',
      statRate: rate,
      statGames: played,
      dayNum: now.getDate(),
      monthNum: now.getMonth() + 1,
      dailyDone: doneToday,
      dailyDesc: doneToday
        ? ('今日成绩 ' + (daily.delta > 0 ? '+' : '') + daily.delta + ' 分 · 已锁定，重玩只作练习')
        : '每天同一副牌，单局定胜负 · 3 人普通场'
    });
    if (st.bgm) audio.startBgm(true); else audio.stopBgm();
  },

  // 续局卡片补上进度信息：轮到谁、各家剩牌，玩家一眼知道要不要续
  buildSessionDesc: function (s) {
    var g = s.game;
    var who = g.players[g.currentSeat] ? g.players[g.currentSeat].name : '';
    var counts = g.players.map(function (p) { return p.hand.length; }).join('/');
    // 文案要能塞进一行：卡片里还有"未完成"竖标、放弃、继续三个元素
    return g.players.length + ' 人 · ' + (s.hotseat ? '热座' : '人机') + ' · ' + who + ' 出牌 · ' + counts;
  },

  onHide: function () { audio.suspend(); },

  onAiCount: function (e) { this.setData({ aiCount: Number(e.currentTarget.dataset.count) }); },
  onAiLevel: function (e) { this.setData({ aiLevel: e.currentTarget.dataset.level }); },
  onHotCount: function (e) { this.setData({ hotCount: Number(e.currentTarget.dataset.count) }); },

  // [DESIGN 2026-11-18] 规则档：经典档保留 4 条强制出牌规则，简化档全部关闭，供新手过渡。
  onRuleMode: function (e) {
    var mode = e.currentTarget.dataset.value === 'SIMPLE' ? 'SIMPLE' : 'CLASSIC';
    var st = app.getSettings();
    st.ruleMode = mode;
    app.saveSettings(st);
    this.setData({ ruleMode: mode });
    audio.vibrate();
  },

  onStartAi: function () {
    // 音频初始化失败不能挡住跳转（否则表现为"点了没反应"）
    try { audio.init(); } catch (e) {}
    wx.navigateTo({
      url: '/pages/game/game?mode=AI&count=' + this.data.aiCount +
        '&level=' + this.data.aiLevel + '&rule=' + this.data.ruleMode
    });
  },

  onStartHot: function () {
    try { audio.init(); } catch (e) {}
    wx.navigateTo({
      url: '/pages/game/game?mode=HOTSEAT&count=' + this.data.hotCount +
        '&level=NORMAL&rule=' + this.data.ruleMode
    });
  },

  onContinue: function () { wx.navigateTo({ url: '/pages/game/game?resume=1' }); },

  // [DESIGN 2026-11-19] 每日挑战：seed = 当天日期，所有人拿到同一副牌，单局定胜负。
  onDaily: function () {
    try { audio.init(); } catch (e) {}
    wx.navigateTo({ url: '/pages/game/game?mode=AI&count=3&level=NORMAL&rule=CLASSIC&daily=1' });
  },

  onDiscardSession: function () {
    var self = this;
    wx.showModal({
      title: '放弃未完成对局',
      content: '确定要放弃当前这局吗？此操作不可撤销。',
      success: function (r) {
        if (r.confirm) { app.clearSession(); self.setData({ hasSession: false }); }
      }
    });
  },

  onNav: function (e) {
    var p = e.currentTarget.dataset.page;
    wx.navigateTo({ url: '/pages/' + p + '/' + p });
  },

  onShareAppMessage: function () {
    return { title: '陕北捉老麻 · 霓虹牌局，来一局？', path: '/pages/index/index' };
  }
});
