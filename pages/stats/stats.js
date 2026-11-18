'use strict';

var app = getApp();
var SBM = app.globalData.SBM;

Page({
  data: { stats: [], leaderboard: [], records: [] },

  onShow: function () { this.refresh(); },

  refresh: function () {
    var s = SBM.store.getStats();
    this.setData({
      stats: [
        { label: '总局数', value: s.games },
        { label: '胜局', value: s.wins },
        { label: '逃跑', value: s.escapes || 0 },
        { label: '累计积分', value: s.totalScore }
      ],
      leaderboard: SBM.store.getLocalLeaderboard(),
      records: SBM.store.getRecords().slice(0, 12).map(function (r) {
        return {
          winner: r.winner,
          modeText: r.mode === 'HOTSEAT' ? '热座' : '人机',
          delta: r.delta
        };
      })
    });
  },

  onClear: function () {
    var self = this;
    wx.showModal({
      title: '清空本机战绩',
      content: '确定清空所有战绩？此操作不可撤销。',
      success: function (r) {
        if (!r.confirm) return;
        SBM.store.clearAll();
        var s = app.getSettings();
        app.saveSettings(s);
        self.refresh();
        wx.showToast({ title: '已清空', icon: 'success' });
      }
    });
  },

  onShareAppMessage: function () {
    return { title: '陕北捉老麻 · 战绩统计', path: '/pages/index/index' };
  }
});
