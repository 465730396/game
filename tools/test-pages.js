'use strict';

// 页面级回归（需在 Node 下跑）：用最小 wx mock 真跑 app.js 与 pages/game/game.js。
// 覆盖的都是"单测跑不到、只在运行时或真机才暴露"的缺陷：
//   1. 续局快照结构校验（坏快照必须丢弃，好快照必须能续）
//   2. 每日挑战结算不得清空进行中的轮次
//   3. 结算延迟跳转必须能被卸载/重开取消
//   4. 热座交接期间不得把真实手牌下发给视图层
//   5. 每日挑战成绩以首次为准
// 运行：node tools/test-pages.js

var path = require('path');
var ROOT = path.resolve(__dirname, '..');

var pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  (' + extra + ')' : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// ---- 最小 wx 环境 ----
var store = {};
var redirects = [];
var navs = [];
var modalConfirm = true;
var innerAudioOpt = null;

global.wx = {
  getStorageSync: function (k) { return store[k] === undefined ? '' : store[k]; },
  setStorageSync: function (k, v) { store[k] = v; },
  removeStorageSync: function (k) { delete store[k]; },
  getWindowInfo: function () { return { screenWidth: 375, screenHeight: 800, pixelRatio: 2, safeArea: { bottom: 760 } }; },
  getSystemInfoSync: function () { return { screenWidth: 375, screenHeight: 800, pixelRatio: 2, safeArea: { bottom: 760 } }; },
  setInnerAudioOption: function (o) { innerAudioOpt = o; },
  getUpdateManager: function () { return null; },
  createInnerAudioContext: function () {
    return { play: function () {}, stop: function () {}, pause: function () {}, paused: true };
  },
  createSelectorQuery: function () {
    var q = {};
    q.in = function () { return q; }; q.select = function () { return q; };
    q.fields = function () { return q; }; q.exec = function () {};
    return q;
  },
  showModal: function (o) { if (o && o.success) o.success({ confirm: modalConfirm, cancel: !modalConfirm }); },
  showToast: function () {},
  vibrateShort: function () {},
  redirectTo: function (o) { redirects.push(o.url); },
  navigateTo: function (o) { navs.push(o.url); },
  reLaunch: function () {},
  setClipboardData: function () {}
};

var appObj = null;
global.App = function (o) { appObj = o; };
require(path.join(ROOT, 'app.js'));
appObj.onLaunch();

var SBM = require(path.join(ROOT, 'bundle.js'));
var controller = SBM.controller;

global.getApp = function () { return appObj; };
var pageCfg = null;
global.Page = function (o) { pageCfg = o; };
require(path.join(ROOT, 'pages/game/game.js'));

function newCtx(opts) {
  var ctx = {};
  Object.keys(pageCfg).forEach(function (k) { ctx[k] = pageCfg[k]; });
  ctx.data = { handoff: false };
  ctx.lastData = null;
  ctx.dataLog = [];
  ctx.setData = function (o) { ctx.lastData = o; ctx.dataLog.push(o); };
  ctx.selected = []; ctx.lines = {}; ctx.totals = {}; ctx.roundHistory = [];
  ctx.alive = true; ctx.redirected = false; ctx.redirectTimer = null;
  ctx.finished = false; ctx.aiTimer = null;
  ctx.fx = { celebrate: function () {}, stop: function () {} };
  Object.keys(opts || {}).forEach(function (k) { ctx[k] = opts[k]; });
  return ctx;
}

function finishedGame(seed) {
  var g = controller.createGame({ playerCount: 3, seed: seed, difficulties: ['HARD', 'HARD', 'HARD'] });
  g.players.forEach(function (p) { p.isAI = true; });
  var guard = 0;
  while (g.status === 'PLAYING' && guard++ < 500) controller.aiTakeTurn(g);
  return g;
}

// ---- 1. 音频与快照校验 ----
section('1. 启动配置与续局快照校验');
ok(!!innerAudioOpt && innerAudioOpt.obeyMuteSwitch === false,
  'iOS 静音键下仍可出声', 'obeyMuteSwitch=' + (innerAudioOpt && innerAudioOpt.obeyMuteSwitch));

function sess(over) {
  var s = {
    game: controller.createGame({ playerCount: 3, seed: 42, difficulties: ['NORMAL', 'NORMAL', 'NORMAL'] }),
    mode: 'AI', level: 'NORMAL', count: 3, hotseat: false,
    activeSeat: 0, roundIndex: 2, roundTotals: {}, roundHistory: []
  };
  Object.keys(over || {}).forEach(function (k) { s[k] = over[k]; });
  return s;
}
appObj.saveSession(sess({}));
ok(!!appObj.getSession(), '正常快照可续');
appObj.clearSession();
store['sbm_session'] = sess({});
ok(appObj.getSession() === null, '老版本快照（无版本号）被拒');
ok(store['sbm_session'] === undefined, '被拒后 storage 立即清除');
appObj.saveSession(sess({ activeSeat: 9 }));
ok(appObj.getSession() === null, 'activeSeat 越界被拒');
appObj.saveSession(sess({}));
store['sbm_session'].game.players[1].hand = undefined;
ok(appObj.getSession() === null, '手牌结构缺失被拒');
appObj.saveSession(sess({}));
store['sbm_session'].game.currentSeat = 7;
ok(appObj.getSession() === null, 'currentSeat 越界被拒');
appObj.saveSession(sess({}));
delete store['sbm_session'].game.config.scoring;
ok(appObj.getSession() === null, '缺计分配置被拒');

// ---- 2. 每日挑战与轮次 ----
section('2. 每日挑战不破坏轮次进度');
var roundCleared = 0, roundSaved = null;
var realClear = appObj.clearRound, realSave = appObj.saveRound;
appObj.clearRound = function () { roundCleared++; };
appObj.saveRound = function (s) { roundSaved = s; return s; };

var a = newCtx({ daily: true, roundIndex: 1, roundSize: 1, hotseat: false, game: finishedGame(11), dailyDate: '2026-11-19' });
a.finishGame();
ok(roundCleared === 0, '每日挑战结算不清轮次', 'clearRound 调用 ' + roundCleared + ' 次');
ok(roundSaved === null, '每日挑战不写轮次状态');

roundCleared = 0; roundSaved = null;
var b = newCtx({ daily: false, roundIndex: 5, roundSize: 5, hotseat: false, game: finishedGame(12) });
b.finishGame();
ok(roundCleared === 1, '第 5/5 局正常清轮次');

roundCleared = 0; roundSaved = null;
var c = newCtx({ daily: false, roundIndex: 2, roundSize: 5, hotseat: false, game: finishedGame(13) });
c.finishGame();
ok(roundSaved && roundSaved.index === 3, '第 2/5 局写入下一局', 'index=' + (roundSaved && roundSaved.index));
ok(roundSaved && typeof roundSaved.nextFirstSeat === 'number', '携带末位先出座位');
appObj.clearRound = realClear; appObj.saveRound = realSave;

// ---- 3. 结算跳转竞态 ----
section('3. 结算延迟跳转可取消');
[a, b, c].forEach(function (x) { x.alive = false; x.clearRedirect(); });
redirects = [];
var d = newCtx({ daily: true, roundIndex: 1, roundSize: 1, hotseat: false, game: finishedGame(14), dailyDate: '2026-11-19' });
d.finishGame();
d.alive = false;
d.onUnload();
ok(d.redirectTimer === null, '卸载后定时器已清除');

redirects = [];
var e = newCtx({ daily: true, roundIndex: 1, roundSize: 1, hotseat: false, game: finishedGame(15), dailyDate: '2026-11-19' });
e.finishGame();
modalConfirm = true;
e.onRestart();
ok(e.redirectTimer === null, '重开后定时器已取消');
ok(e.game.status === 'PLAYING', '重开产生新对局');

// ---- 4. 热座遮挡 ----
section('4. 热座交接期间不下发手牌');
var h = newCtx({ hotseat: true, activeSeat: 1, level: 'NORMAL', ruleMode: 'CLASSIC' });
h.game = controller.createGame({ playerCount: 3, seed: 3, difficulties: ['NORMAL', 'NORMAL', 'NORMAL'] });
h.game.players.forEach(function (p) { p.isAI = false; });
var realCount = h.game.players[1].hand.length;
h.data = { handoff: true };
h.render();
ok(h.lastData.hand.length === 0, '交接中 hand 为空', '真实手牌 ' + realCount + ' 张');
ok(h.lastData.handTitle.indexOf('遮挡') >= 0, '标题提示已遮挡');
var played = 0, origPlay = controller.play;
controller.play = function () { played++; return { ok: false }; };
h.selected = [h.game.players[1].hand[0].id];
h.onPlay();
ok(played === 0, '交接中出牌被拦截');
controller.play = origPlay;
h.data = { handoff: false };
h.render();
ok(h.lastData.hand.length === realCount, '接手后手牌恢复', '共 ' + h.lastData.hand.length + ' 张');
h.game = null;

// ---- 4.5 牌桌实时倍率 ----
section('4.5 炸弹落地即在牌桌显示倍率');
var m = newCtx({ hotseat: false, activeSeat: 0, level: 'NORMAL', ruleMode: 'CLASSIC',
  roundIndex: 1, roundSize: 5, daily: false });
m.game = controller.createGame({ playerCount: 3, seed: 21, difficulties: ['NORMAL', 'NORMAL', 'NORMAL'] });
m.game.players.forEach(function (p) { p.isAI = true; });
m.render();
ok(m.lastData.multiplier === 1 && !m.lastData.multFlash, '无炸弹时不挂倍率徽标');
var bombCards = m.game.players[1].hand.slice(0, 4);
m.game.playLog.push({ seat: 1, cards: bombCards, detected: { type: 'BOMB_QUAD', key: 5 } });
m.render();
ok(m.lastData.multiplier === 2, '炸弹落地后牌桌倍率 ×2', '×' + m.lastData.multiplier);
ok(m.lastData.multFlash === true, '翻倍瞬间触发闪烁');
m.render();
ok(m.lastData.multFlash === false, '同一倍率不重复闪烁');
m.game.playLog.push({ seat: 2, cards: bombCards, detected: { type: 'BOMB_QUAD', key: 6 } });
m.render();
ok(m.lastData.multiplier === 4, '第二颗炸弹封顶 ×4');
m.clearMultTimer();
m.alive = false;
m.game = null;

// ---- 4.6 炸弹高光横幅 ----
section('4.6 炸弹落地弹出高光横幅');
var bb = newCtx({ hotseat: false, activeSeat: 0, level: 'NORMAL', ruleMode: 'CLASSIC',
  roundIndex: 1, roundSize: 5, daily: false });
bb.game = controller.createGame({ playerCount: 3, seed: 22, difficulties: ['NORMAL', 'NORMAL', 'NORMAL'] });
bb.game.players.forEach(function (p) { p.isAI = true; });
bb.game.playLog = [{ seat: 1, cards: [], detected: { type: 'BOMB_QUAD', key: 5 } }];
bb.flashPlay(true, { type: 'BOMB_QUAD' });
ok(bb.lastData.bombBanner === true && bb.lastData.bombBannerTitle === '炸 弹', '普通炸弹：横幅标题正确');
ok(bb.lastData.bombBannerText.indexOf('×2') >= 0, '横幅标出本局 ×2', bb.lastData.bombBannerText);
bb.game.playLog = [{ seat: 1, cards: [], detected: { type: 'BOMB_AAA', key: 99 } }];
bb.flashPlay(true, { type: 'BOMB_AAA' });
ok(bb.lastData.bombBannerTitle === '天 炸' && bb.lastData.bombBannerText.indexOf('×4') >= 0,
  '天炸单独成词并标 ×4', bb.lastData.bombBannerText);
// 封顶后再炸：倍率不再上涨，文案必须如实说明
bb.lastMultiplier = 4;
bb.game.playLog = [
  { seat: 1, cards: [], detected: { type: 'BOMB_AAA', key: 99 } },
  { seat: 2, cards: [], detected: { type: 'BOMB_QUAD', key: 6 } }
];
bb.flashPlay(true, { type: 'BOMB_QUAD' });
ok(bb.lastData.bombBannerText.indexOf('封顶') >= 0, '封顶后再炸显示"已封顶"', bb.lastData.bombBannerText);
ok(!!bb.bombTimer, '横幅有自动收起定时器');
bb.clearBombTimer();
ok(bb.bombTimer === null, '切页/重开时横幅定时器可取消');
// 重开必须收掉残留横幅，否则新局头 1.4 秒会挂着上一局的倍率
bb.alive = true;
bb.hotseat = false;
bb.data = { handoff: false, bombBanner: true };
bb.dataLog = [];
bb.onRestart();
ok(bb.dataLog.some(function (d) { return d && d.bombBanner === false; }), '重开时显式收起残留横幅');
bb.alive = false;
bb.game = null;

// ---- 5. 每日挑战成绩锁定 ----section('5. 每日挑战成绩以首次为准');
// 第 2 节的每日挑战结算已经写过当天成绩，这里必须清掉，否则测的是"已锁定"而不是"首次写入"
delete store['sbm_daily'];
var f = newCtx({ daily: true, dailyDate: '2026-11-19' });
f.saveDaily(120, true);
f.saveDaily(999, true);
ok(store['sbm_daily'] && store['sbm_daily'].delta === 120, '同日重打不覆盖首次成绩', '保留 ' + (store['sbm_daily'] && store['sbm_daily'].delta));
var f2 = newCtx({ daily: true, dailyDate: '2026-11-20' });
f2.saveDaily(80, false);
ok(store['sbm_daily'].delta === 80, '次日写入新成绩');

// ---- 6. 隐私指引页的"删除本机数据" ----
section('6. 隐私页可删除本机数据（保留设置）');
var privacyCfg = null;
global.Page = function (o) { privacyCfg = o; };
require(path.join(ROOT, 'pages/privacy/privacy.js'));
store['sbm_records'] = [{ name: '我', delta: 5 }];
store['sbm_stats'] = { games: 3, wins: 1, escapes: 0, totalScore: 5 };
store['sbm_session'] = sess({});
store['sbm_round'] = { index: 2, size: 5, totals: {} };
store['sbm_daily'] = { date: '2026-11-19', delta: 40 };
store['sbm_errlog'] = [{ msg: 'x' }];
store['sbm_settings'] = { bgm: true, dialect: true, largeFont: true, vibration: true };
var pctx = {};
Object.keys(privacyCfg).forEach(function (k) { pctx[k] = privacyCfg[k]; });
pctx.data = { sections: [] };
pctx.setData = function (o) { Object.keys(o).forEach(function (k) { pctx.data[k] = o[k]; }); };
modalConfirm = true;
pctx.onClear();
ok(store['sbm_records'] === undefined && store['sbm_stats'] === undefined, '对局记录与统计已删除');
ok(store['sbm_session'] === undefined && store['sbm_round'] === undefined, '续局快照与轮次已删除');
ok(store['sbm_daily'] === undefined && store['sbm_errlog'] === undefined, '每日成绩与异常日志已删除');
ok(store['sbm_settings'] && store['sbm_settings'].bgm === true, '用户设置被保留（不误删偏好）');
ok(pctx.data.cleared === true, '页面状态提示已清除');
modalConfirm = false;
store['sbm_records'] = [{ name: '我', delta: 5 }];
pctx.onClear();
ok(store['sbm_records'] !== undefined, '取消确认时不删除任何数据');

// ---- 6.5 结算数据自洽（名次、守恒、倍率、轮次累计）----
// [REGRESSION 2026-11-19] 规则全流程回归：结算页看到的东西必须和引擎算的一致。
section('6.5 结算数据自洽');
var sctx = newCtx({
  daily: false, roundIndex: 2, roundSize: 5, hotseat: false, mode: 'AI', level: 'NORMAL', count: 3,
  totals: { 0: 10, 1: -4, 2: -6 }
});
sctx.game = finishedGame(21);
sctx.finishGame();
var lr = appObj.globalData.lastResult;
ok(lr.scores[0].rank === 1 && lr.scores[0].seat === sctx.game.winnerSeat, '结算榜第 1 行是赢家');
ok(lr.scores.every(function (r, i) { return i === 0 || r.rank === lr.scores[i - 1].rank + 1; }), '名次 1..N 连续升序');
ok(lr.scores.reduce(function (a, r) { return a + r.delta; }, 0) === 0, '本局 delta 之和为 0（有赢必有输）');
ok(lr.round.totals.every(function (t) {
  var row = lr.scores.filter(function (r) { return r.seat === t.seat; })[0];
  return t.total === (sctx.totals[t.seat] || 0) + row.delta;
}), '轮次累计 = 上一轮累计 + 本局 delta');
ok(lr.round.index === 2 && lr.round.size === 5, '轮次进度 2/5 正确');
ok(lr.round.history.length === 1 && lr.round.history[0].no === 2, '逐局得分记入第 2 局');
ok(lr.multiplier === (sctx.game.settlement.multiplier || 1) && lr.bombPoints === (sctx.game.settlement.bombPoints || 0),
  '倍率与炸弹点数与结算一致', '×' + lr.multiplier + ' / ' + lr.bombPoints + ' 点');
sctx.alive = false; sctx.clearRedirect();

// ---- 6.6 结算页倍率与逐局留痕 ----
section('6.6 结算页标出倍率与炸过的局');
var resultCfg = null;
global.Page = function (o) { resultCfg = o; };
require(path.join(ROOT, 'pages/result/result.js'));
function resultCtx() {
  var ctx = {};
  Object.keys(resultCfg).forEach(function (k) { ctx[k] = resultCfg[k]; });
  ctx.data = {};
  ctx.lastData = {};
  ctx.setData = function (o) { ctx.lastData = Object.assign(ctx.lastData, o); };
  return ctx;
}
appObj.globalData.lastResult = {
  scores: [{ seat: 0, name: '我', rank: 1, remaining: 0, delta: 24, bombCount: 1 }],
  winnerName: '我', winnerSeat: 0, won: true, hotseat: false,
  multiplier: 4, bombPoints: 2,
  round: {
    index: 3, size: 5, done: true,
    totals: [{ seat: 0, name: '我', total: 30 }],
    history: [
      { no: 1, delta: 6, multiplier: 1 },
      { no: 2, delta: -8, multiplier: 1 },
      { no: 3, delta: 24, multiplier: 4 }
    ]
  },
  mode: 'AI', level: 'NORMAL', count: 3, daily: false, ruleSetId: 'sbm-lmz-v1', time: '11-19 14:00'
};
var rc = resultCtx();
rc.onLoad();
ok(/×4/.test(rc.lastData.multiText), '结算页标出本局倍率 ×4', rc.lastData.multiText);
ok(rc.lastData.history.length === 3 && rc.lastData.history[2].multiplier === 4,
  '逐局历史保留每局倍率');
ok(/本轮最高倍率 ×4/.test(rc.lastData.roundPeakText), '轮次结束显示本轮最高倍率', rc.lastData.roundPeakText);

// 等待可能的残留定时器执行，确认没有漏网跳转
setTimeout(function () {
  section('7. 无残留跳转');
  ok(redirects.length === 0, '本轮用例未触发任何结算跳转', 'redirectTo ' + redirects.length + ' 次');
  console.log('\n总计 PASS=' + pass + '  FAIL=' + fail);
  process.exit(fail ? 1 : 0);
}, 700);
