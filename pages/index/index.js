'use strict';

var app = getApp();
var SBM = app.globalData.SBM;
var audio = require('../../utils/audio.js');

Page({
  data: {
    counts: [2, 3, 4],
    levels: [{ value: 'EASY', label: '简单' }, { value: 'NORMAL', label: '普通' }, { value: 'HARD', label: '困难' }],
    aiCount: 3,
    aiLevel: 'NORMAL',
    hotCount: 3,
    hasSession: false,
    sessionDesc: ''
  },

  onShow: function () {
    audio.init();
    var s = app.getSession();
    this.setData({
      hasSession: !!(s && s.game && s.game.status === 'PLAYING'),
      sessionDesc: s ? ((s.game.players.length + ' 人 · ') + (s.hotseat ? '热座' : '人机')) : ''
    });
    // 首页也放 BGM（若设置开启）
    var st = app.getSettings();
    if (st.bgm) audio.startBgm(true); else audio.stopBgm();
  },

  onHide: function () { audio.suspend(); },

  onAiCount: function (e) { this.setData({ aiCount: Number(e.currentTarget.dataset.count) }); },
  onAiLevel: function (e) { this.setData({ aiLevel: e.currentTarget.dataset.level }); },
  onHotCount: function (e) { this.setData({ hotCount: Number(e.currentTarget.dataset.count) }); },

  onStartAi: function () {
    audio.init();
    wx.navigateTo({ url: '/pages/game/game?mode=AI&count=' + this.data.aiCount + '&level=' + this.data.aiLevel });
  },

  onStartHot: function () {
    audio.init();
    wx.navigateTo({ url: '/pages/game/game?mode=HOTSEAT&count=' + this.data.hotCount + '&level=NORMAL' });
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
