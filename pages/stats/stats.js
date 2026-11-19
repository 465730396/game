'use strict';

var app = getApp();
var SBM = app.globalData.SBM;

function fmtTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

Page({
  data: { stats: [], leaderboard: [], records: [], largeFont: false, total: 0 },

  onShow: function () {
    this.setData({ largeFont: app.getSettings().largeFont !== false });
    this.refresh();
  },

  refresh: function () {
    var s = SBM.store.getStats();
    var records = SBM.store.getRecords();
    this.setData({
      total: records.length,
      stats: [
        { label: '总局数', value: s.games },
        { label: '胜局', value: s.wins },
        { label: '逃跑', value: s.escapes || 0 },
        { label: '累计积分', value: s.totalScore }
      ],
      leaderboard: SBM.store.getLocalLeaderboard(),
      // [RELEASE 2026-11-18] 记录补上时间与名次，旧实现只有"胜/负 + 积分"，看不出是哪一局。
      records: records.slice(0, 12).map(function (r) {
        var hot = r.mode === 'HOTSEAT';
        return {
          winner: r.winner,
          // 热座没有"胜负"主体，标成"—"而不是"负"，否则一局热座会显示三条"负"
          resultText: hot ? '—' : (r.winner ? '胜' : '负'),
          modeText: hot ? '热座' : '人机',
          rankText: hot ? '' : (r.rank ? ('第 ' + r.rank + ' 名') : ''),
          timeText: fmtTime(r.createdAt),
          delta: r.delta
        };
      })
    });
  },

  onClear: function () {
    var self = this;
    wx.showModal({
      title: '清空本机战绩',
      content: '将清空对局记录与统计，设置不会受影响。确定继续？',
      success: function (r) {
        if (!r.confirm) return;
        // 只清记录与统计，保留 bgm/大字/振动等设置（旧实现用 clearAll 会连带清掉设置）
        SBM.store.clearRecords();
        self.refresh();
        wx.showToast({ title: '已清空', icon: 'success' });
      }
    });
  },

  onShareAppMessage: function () {
    return { title: '陕北捉老麻 · 战绩统计', path: '/pages/index/index' };
  }
});
