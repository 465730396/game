'use strict';

var app = getApp();
var SBM = app.globalData.SBM;
var audio = require('../../utils/audio.js');

Page({
  data: {
    largeFont: false,
    counts: [2, 3, 4],
    levels: [{ value: 'EASY', label: '简单' }, { value: 'NORMAL', label: '普通' }, { value: 'HARD', label: '困难' }],
    aiCount: 3,
    aiLevel: 'NORMAL',
    hotCount: 3,
    ruleMode: 'CLASSIC',
    rules: [{ value: 'CLASSIC', label: '经典规则' }, { value: 'SIMPLE', label: '简化规则' }],
    hasSession: false,
    sessionDesc: ''
  },

  onShow: function () {
    audio.init();
    var st = app.getSettings();
    var s = app.getSession();
    // 快照可能因旧版本/异常写入而不完整，逐层校验，避免 s.game 缺失时直接抛错白屏
    var alive = !!(s && s.game && s.game.players && s.game.players.length && s.game.status === 'PLAYING');
    this.setData({
      largeFont: st.largeFont !== false,
      ruleMode: st.ruleMode === 'SIMPLE' ? 'SIMPLE' : 'CLASSIC',
      hasSession: alive,
      sessionDesc: alive ? this.buildSessionDesc(s) : ''
    });
    if (st.bgm) audio.startBgm(true); else audio.stopBgm();
  },

  // 续局卡片补上进度信息：轮到谁、各家剩牌，玩家一眼知道要不要续
  buildSessionDesc: function (s) {
    var g = s.game;
    var who = g.players[g.currentSeat] ? g.players[g.currentSeat].name : '';
    var counts = g.players.map(function (p) { return p.hand.length; }).join('/');
    return g.players.length + ' 人 · ' + (s.hotseat ? '热座' : '人机') + ' · 轮到 ' + who + ' · 剩牌 ' + counts;
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
    audio.init();
    wx.navigateTo({
      url: '/pages/game/game?mode=AI&count=' + this.data.aiCount +
        '&level=' + this.data.aiLevel + '&rule=' + this.data.ruleMode
    });
  },

  onStartHot: function () {
    audio.init();
    wx.navigateTo({
      url: '/pages/game/game?mode=HOTSEAT&count=' + this.data.hotCount +
        '&level=NORMAL&rule=' + this.data.ruleMode
    });
  },

  onContinue: function () { wx.navigateTo({ url: '/pages/game/game?resume=1' }); },

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
    return { title: '陕北捉老麻 · 夜宴牌局，来一局？', path: '/pages/index/index' };
  }
});
