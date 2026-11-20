'use strict';

var app = getApp();

Page({
  data: {
    largeFont: false,
    ruleTypes: [
      { name: '单张 / 对子 / 三张', desc: '按点数比大小' },
      { name: '三带一 / 三带二', desc: '按三张点数比' },
      { name: '顺子', desc: '5 张起，3 到 K' },
      { name: '连对', desc: '3 对起，3 到 K' },
      { name: '飞机 / 飞机带翅膀', desc: '2 组连续三张起' },
      { name: '炸弹', desc: '四张同点，压任何非炸' },
      { name: '天炸', desc: 'AAA，全场最大' }
    ]
  },

  onShow: function () {
    this.setData({ largeFont: app.getSettings().largeFont !== false });
  },

  onShareAppMessage: function () {
    return { title: '陕北捉老麻 · 玩法规则', path: '/pages/index/index' };
  }
});
