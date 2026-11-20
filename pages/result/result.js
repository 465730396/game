'use strict';

var app = getApp();
var privacy = require('../../utils/privacy.js');

Page({
  data: {
    noData: false, won: false, badgeText: '', badgeClass: '',
    title: '', ruleSetId: '', time: '', scores: [], hotseat: false,
    largeFont: false,
    roundIndex: 0, roundSize: 0, roundDone: false, roundLabel: '', againLabel: '再来一局',
    totals: [], history: [], multiplier: 1, multiText: '', dailyTip: '', roundPeakText: ''
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

    var rd = r.round || null;
    var roundLabel = rd ? ('第 ' + rd.index + ' / ' + rd.size + ' 局') : '';
    var againLabel = rd && !rd.done ? ('下一局（第 ' + (rd.index + 1) + ' 局）') : '开始新一轮';
    // 每日挑战是单局制，按钮语义要跟着变
    if (r.daily) againLabel = '再练一次';
    var dailyTip = r.daily ? '每日挑战成绩以首次完成为准，重玩不计入今日成绩' : '';

    // [FIX 2026-11-19] 逐局历史带上倍率：稀有事件在一轮结束时要留痕，
    // 否则打完 5 局只看到一个总分，玩家根本不知道中间有过一局 ×4。
    var hist = (rd && rd.history ? rd.history : []).map(function (h) {
      return { no: h.no, delta: h.delta, multiplier: h.multiplier || 1 };
    });
    var roundPeak = hist.reduce(function (m, h) { return Math.max(m, h.multiplier); }, 1);

    this.setData({
      noData: false,
      won: !!r.won,
      badgeText: badgeText,
      badgeClass: badgeClass,
      title: title,
      ruleSetId: r.ruleSetId || '',
      time: r.time || '',
      scores: r.scores || [],
      hotseat: !!r.hotseat,
      roundIndex: rd ? rd.index : 0,
      roundSize: rd ? rd.size : 0,
      roundDone: rd ? !!rd.done : false,
      roundLabel: roundLabel,
      againLabel: againLabel,
      totals: rd && rd.totals ? rd.totals.slice().sort(function (a, b) { return b.total - a.total; }) : [],
      history: hist,
      roundPeakText: (rd && rd.done && roundPeak > 1) ? ('本轮最高倍率 ×' + roundPeak) : '',
      multiplier: r.multiplier || 1,
      multiText: (r.multiplier && r.multiplier > 1) ? ('本局炸弹翻倍 ×' + r.multiplier) : '',
      dailyTip: dailyTip
    });

    // [FIX 2026-11-19] 不再在进页面时预画战绩图。canvasToTempFilePath 会在主线程
    // 画一张 750×1000 的图并落一个临时文件，而九成玩家不会点"保存"。改为点击时生成，
    // 分享则使用微信默认页面截图。
  },

  // 再来一局沿用本局的模式 / 人数 / 难度；旧实现固定 NORMAL，玩家选困难打完却变回普通。
  // 一轮未打满时带上 round=1 继续累计，打满则开新一轮。
  onAgain: function () {
    var r = app.globalData.lastResult || {};
    // 每日挑战重玩：仍走同一天的固定 seed，而不是掉进普通对局
    if (r.daily) {
      wx.redirectTo({ url: '/pages/game/game?mode=AI&count=3&level=NORMAL&rule=CLASSIC&daily=1' });
      return;
    }
    var mode = r.mode || (r.hotseat ? 'HOTSEAT' : 'AI');
    var level = r.level || 'NORMAL';
    var count = r.count || (r.scores ? r.scores.length : 3);
    var rd = r.round || null;
    var next = rd && !rd.done ? '&round=1' : '';
    if (rd && rd.done) app.clearRound();
    wx.redirectTo({ url: '/pages/game/game?mode=' + mode + '&count=' + count + '&level=' + level + next });
  },

  // reLaunch 而不是 navigateBack(2)：牌桌是 redirectTo 替换进来的，栈深不可靠。
  onHome: function () { wx.reLaunch({ url: '/pages/index/index' }); },

  // [DESIGN 2026-11-18] 战绩图：棋牌类小程序的增长几乎全靠"拉人开局"，
  // 旧版分享只有标题没有图，点开率极低。这里用 canvas 2d 现画一张可直接保存的战绩卡。
  ensurePoster: function (cb) {
    var self = this;
    if (this.posterPath) { if (cb) cb(this.posterPath); return; }
    if (this.buildingPoster) return;
    var r = app.globalData.lastResult;
    if (!r) { if (cb) cb(null); return; }
    this.buildingPoster = true;
    wx.createSelectorQuery().select('#poster').fields({ node: true, size: true }).exec(function (res) {
      self.buildingPoster = false;
      var node = res && res[0] && res[0].node;
      if (!node) { if (cb) cb(null); return; }
      var W = 750, H = 1000;
      node.width = W; node.height = H;
      var ctx = node.getContext('2d');
      self.paintPoster(ctx, W, H, r);
      wx.canvasToTempFilePath({
        canvas: node, x: 0, y: 0, width: W, height: H, destWidth: W, destHeight: H,
        success: function (out) { self.posterPath = out.tempFilePath; if (cb) cb(out.tempFilePath); },
        fail: function () { if (cb) cb(null); }
      });
    });
  },

  paintPoster: function (ctx, W, H, r) {
    // [DESIGN 2026-11-19] 战绩图跟着视觉体系一起换：近黑底 + 顶部洋红辉光 + 青色网格 + 发光判定。
    // 这张图是要被发到聊天窗里的，它比页面本身更代表"这游戏长什么样"。
    var CYAN = '#2CF2FF', MAGENTA = '#FF2D7A', ACID = '#C9FF24';
    var INK = '#E9F5FF', DIM = '#7E96AD', JADE = '#35E6A8';

    ctx.fillStyle = '#04060C'; ctx.fillRect(0, 0, W, H);

    var top = ctx.createRadialGradient(W / 2, -80, 0, W / 2, -80, H * 0.78);
    top.addColorStop(0, 'rgba(255,45,122,0.40)');
    top.addColorStop(0.44, 'rgba(255,45,122,0.09)');
    top.addColorStop(1, 'rgba(255,45,122,0)');
    ctx.fillStyle = top; ctx.fillRect(0, 0, W, H);

    var bot = ctx.createRadialGradient(W / 2, H * 0.96, 0, W / 2, H * 0.96, W * 0.86);
    bot.addColorStop(0, 'rgba(44,242,255,0.20)');
    bot.addColorStop(0.5, 'rgba(44,242,255,0.04)');
    bot.addColorStop(1, 'rgba(44,242,255,0)');
    ctx.fillStyle = bot; ctx.fillRect(0, H * 0.44, W, H * 0.56);

    // 细网格：给海报一层"屏幕"质感
    ctx.strokeStyle = 'rgba(44,242,255,0.06)'; ctx.lineWidth = 1;
    for (var gx = 0; gx <= W; gx += 50) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (var gy = 0; gy <= H; gy += 50) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

    ctx.strokeStyle = 'rgba(44,242,255,0.32)'; ctx.lineWidth = 2; ctx.strokeRect(40, 40, W - 80, H - 80);
    // 对角双色角标
    ctx.strokeStyle = 'rgba(255,45,122,0.80)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(40, 190); ctx.lineTo(40, 40); ctx.lineTo(190, 40); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W - 40, H - 190); ctx.lineTo(W - 40, H - 40); ctx.lineTo(W - 190, H - 40); ctx.stroke();

    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(44,242,255,0.65)'; ctx.shadowBlur = 18;
    ctx.fillStyle = CYAN; ctx.font = 'bold 38px sans-serif';
    ctx.fillText('陕北捉老麻', W / 2, 138);
    ctx.shadowBlur = 0;
    ctx.fillStyle = DIM; ctx.font = '20px sans-serif';
    ctx.fillText('N E O N   S H A D O W   ·   娱乐积分', W / 2, 178);

    var win = !r.hotseat && r.won;
    var lose = !r.hotseat && !r.won;
    var ring = win ? CYAN : (lose ? MAGENTA : DIM);
    ctx.strokeStyle = ring; ctx.globalAlpha = 0.34; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, 320, 114, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.shadowColor = ring; ctx.shadowBlur = 34;
    ctx.fillStyle = r.hotseat ? INK : (win ? ACID : MAGENTA);
    ctx.font = 'bold 92px sans-serif';
    ctx.fillText(r.hotseat ? '赢家' : (win ? '胜' : '负'), W / 2, 354);
    ctx.shadowBlur = 0;

    ctx.fillStyle = INK; ctx.font = 'bold 30px sans-serif';
    var line = r.hotseat ? (r.winnerName + ' 赢下这一局')
      : (win ? '你赢下这一局' : (r.winnerName + ' 赢下这一局'));
    ctx.fillText(line, W / 2, 428);

    var rd = r.round || {};
    ctx.fillStyle = DIM; ctx.font = '22px sans-serif';
    ctx.fillText((rd.index ? ('第 ' + rd.index + ' / ' + rd.size + ' 局') : '') + (r.time ? ('  ·  ' + r.time) : ''), W / 2, 470);

    if (r.multiplier && r.multiplier > 1) {
      ctx.fillStyle = MAGENTA; ctx.font = 'bold 24px sans-serif';
      ctx.fillText('炸弹翻倍 ×' + r.multiplier, W / 2, 512);
    }

    ctx.strokeStyle = 'rgba(44,242,255,0.20)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(120, 546); ctx.lineTo(W - 120, 546); ctx.stroke();

    var rows = (r.scores || []).slice(0, 4);
    rows.forEach(function (row, i) {
      var y = 606 + i * 74;
      ctx.textAlign = 'left';
      ctx.fillStyle = i === 0 ? CYAN : DIM;
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText(String(row.rank), 150, y);
      ctx.fillStyle = INK; ctx.font = '30px sans-serif';
      ctx.fillText(row.name, 204, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = row.delta > 0 ? MAGENTA : JADE;
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText((row.delta > 0 ? '+' : '') + row.delta, W - 150, y);
      ctx.textAlign = 'center';
    });

    ctx.fillStyle = DIM; ctx.font = '22px sans-serif';
    ctx.fillText('微信搜索「陕北捉老麻」一起来一局', W / 2, H - 92);
    ctx.fillStyle = 'rgba(126,150,173,0.7)'; ctx.font = '18px sans-serif';
    ctx.fillText('娱乐积分，不兑换任何物品', W / 2, H - 60);
  },

  onSavePoster: function () {
    var self = this;
    if (this.savingPoster) return;
    this.savingPoster = true;
    // [RELEASE 2026-11-18] 隐私授权必须在用户手势的同步链路里拉起：先要授权，再画 canvas。
    // 反过来（画完再弹）手势上下文已丢失，弹窗拉不起来——详见 utils/privacy.js。
    privacy.ensurePrivacy(function (agreed) {
      if (!agreed) {
        self.savingPoster = false;
        self.showSaveFail('privacy', null);
        return;
      }
      wx.showLoading({ title: '生成中', mask: true });
      self.ensurePoster(function (path) {
        wx.hideLoading();
        if (!path) {
          self.savingPoster = false;
          wx.showToast({ title: '生成失败，可先截图保存', icon: 'none' });
          return;
        }
        privacy.saveImage(path, function (ok, reason) {
          self.savingPoster = false;
          if (ok) { wx.showToast({ title: '已保存到相册' }); return; }
          self.showSaveFail(reason, path);
        });
      });
    });
  },

  // 失败分流：隐私未同意 / 相册权限被拒 / 系统级关闭 / 其他，四种原因给四种出口。
  // 旧实现把所有失败都归为"auth 或 deny"，隐私未授权时玩家会陷入死循环。
  showSaveFail: function (reason, path) {
    var tip = privacy.explain(reason);
    wx.showModal({
      title: tip.title,
      content: tip.content,
      confirmText: tip.confirmText,
      cancelText: reason === 'other' ? '取消' : '稍后',
      success: function (m) {
        if (!m.confirm) return;
        if (reason === 'privacy') {
          // 隐私协议不在 openSetting 里，跳设置页只会让玩家困惑；直接打开正文页
          privacy.openGuide();
        } else if (reason === 'denied') {
          privacy.openAlbumSetting(function () {});
        } else if (reason === 'other' && path) {
          wx.previewImage({ urls: [path], current: path });
        }
      }
    });
  },

  onShareAppMessage: function () {
    var r = app.globalData.lastResult || {};
    var title = r.won ? '我赢下了这一局，陕北捉老麻来一局？'
      : (r.round && r.round.index ? ('第 ' + r.round.index + ' 局打完了，来一局陕北捉老麻？') : '陕北捉老麻 · 来一局？');
    var out = { title: title, path: '/pages/index/index' };
    if (this.posterPath) out.imageUrl = this.posterPath;
    return out;
  }
});
