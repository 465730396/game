'use strict';

var app = getApp();

Page({
  data: {
    won: false, title: '', ruleSetId: '', time: '', scores: [], hotseat: false
  },

  onLoad: function () {
    var r = app.globalData.lastResult;
    if (!r) {
      wx.showToast({ title: '暂无结算数据', icon: 'none' });
      return;
    }
    this.setData({
      won: r.won,
      title: (r.hotseat || !r.won) ? (r.winnerName + ' 赢下这一局') : '你赢下这一局',
      ruleSetId: r.ruleSetId, time: r.time, scores: r.scores, hotseat: r.hotseat
    });
  },

  onAgain: function () {
    var r = app.globalData.lastResult || {};
    wx.redirectTo({
      url: '/pages/game/game?mode=' + (r.hotseat ? 'HOTSEAT' : 'AI') + '&count=' + (r.scores ? r.scores.length : 3) + '&level=NORMAL'
    });
  },

  onHome: function () { wx.navigateBack({ delta: 2 }); },

  onShareAppMessage: function () {
    return { title: '陕北捉老麻 · 来一局？', path: '/pages/index/index' };
  }
});
