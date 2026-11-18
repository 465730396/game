'use strict';

var app = getApp();

Page({
  data: {
    noData: false, won: false, badgeText: '', badgeClass: '',
    title: '', ruleSetId: '', time: '', scores: [], hotseat: false,
    largeFont: false
  },

  onLoad: function () {
    this.setData({ largeFont: app.getSettings().largeFont !== false });
    var r = app.globalData.lastResult;
    if (!r) {
      // [RELEASE 2026-11-18] 兜底：小程序被回收或热重载后结算数据可能丢失，
      // 旧实现只弹 toast，页面上仍是空的胜负与积分，玩家看着像坏了。
      this.setData({ noData: true, title: '本局数据已失效' });
      return;
    }
    // 角标语义修正：热座没有"我"的概念。旧逻辑用 winnerSeat===0 判断胜负，
    // 其他玩家赢时会显示"玩家X 赢下这一局"却配一个"负"角标，自相矛盾。
    var badgeText = r.hotseat ? '赢家' : (r.won ? '胜' : '负');
    var badgeClass = r.hotseat ? 'draw' : (r.won ? 'win' : 'lose');
    var title;
    if (r.hotseat) title = r.winnerName + ' 赢下这一局';
    else title = r.won ? '你赢下这一局' : (r.winnerName + ' 赢下这一局');

    this.setData({
      noData: false,
      won: !!r.won,
      badgeText: badgeText,
      badgeClass: badgeClass,
      title: title,
      ruleSetId: r.ruleSetId || '',
      time: r.time || '',
      scores: r.scores || [],
      hotseat: !!r.hotseat
    });
  },

  // 再来一局沿用本局的模式 / 人数 / 难度；旧实现固定 NORMAL，玩家选困难打完却变回普通。
  onAgain: function () {
    var r = app.globalData.lastResult || {};
    var mode = r.mode || (r.hotseat ? 'HOTSEAT' : 'AI');
    var level = r.level || 'NORMAL';
    var count = r.count || (r.scores ? r.scores.length : 3);
    wx.redirectTo({ url: '/pages/game/game?mode=' + mode + '&count=' + count + '&level=' + level });
  },

  // reLaunch 而不是 navigateBack(2)：牌桌是 redirectTo 替换进来的，栈深不可靠。
  onHome: function () { wx.reLaunch({ url: '/pages/index/index' }); },

  onShareAppMessage: function () {
    return { title: '陕北捉老麻 · 来一局？', path: '/pages/index/index' };
  }
});
