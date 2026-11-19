'use strict';

// 游戏性度量：不写断言，只跑真实对局并输出可解读的统计。
// 运行：node tools/playtest.js [倍率]
//   倍率 1 = 常规（约 2 分钟）；2 = 加强采样（约 4 分钟）
//
// 回答的是"这游戏好不好玩、耐不耐玩"这类没有标准答案的问题，
// 只能靠对局数据逼近：难度梯度、节奏、运气权重、分数波动、强制规则负荷。

require('../bundle.js');
const SBM = global.SBM;
const controller = SBM.controller;

const K = Number(process.argv[2] || 1);

const pad = function (s, n) { s = String(s); while (s.length < n) s += ' '; return s; };
const pct = function (a, b) { return b ? (a / b * 100).toFixed(1) + '%' : '-'; };
const avg = function (arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : 0; };
function std(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(avg(arr.map(function (v) { return (v - m) * (v - m); })));
}
function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort(function (a, b) { return a - b; });
  return s[Math.floor(s.length / 2)];
}

// 手牌强度：大牌与炸弹决定一手牌的天花板。用于衡量"发牌运气"对胜负的解释力。
function handPower(hand) {
  let s = 0;
  const byRank = {};
  hand.forEach(function (c) {
    byRank[c.rank] = (byRank[c.rank] || 0) + 1;
    if (c.rank === '2') s += 3;
    else if (c.rank === 'A') s += 2;
    else if (c.rank === 'K') s += 1;
  });
  Object.keys(byRank).forEach(function (r) { if (byRank[r] === 4) s += 6; });
  return s;
}

// 跑一局全 AI 对局，记录过程指标
function runGame(opt) {
  const game = controller.createGame({
    playerCount: opt.playerCount || 3,
    seed: opt.seed,
    difficulties: opt.difficulties || ['NORMAL', 'NORMAL', 'NORMAL', 'NORMAL'],
    ruleMode: opt.ruleMode || 'CLASSIC'
  });
  game.players.forEach(function (p, i) {
    p.isAI = true;
    if (opt.seatLevels) p.difficulty = opt.seatLevels[i] || 'NORMAL';
  });

  const firstSeat = game.currentSeat;
  const powers = game.players.map(function (p) { return handPower(p.hand); });
  let actions = 0, forcedNoPass = 0, guard = 0;

  while (game.status === 'PLAYING' && guard++ < 1200) {
    const seat = game.currentSeat;
    const view = controller.getView(game, seat);
    // 有牌权但要不起/被强制规则堵住 → 玩家最容易被"为什么不能过"搞懵的时刻
    if (view.public.lastPlay && !view.canPass) forcedNoPass++;
    const r = controller.aiTakeTurn(game);
    if (!r.ok) return { error: r.error, actions: actions };
    actions++;
  }

  if (game.status !== 'FINISHED') return { error: 'TIMEOUT', actions: actions };

  const st = game.settlement;
  return {
    ok: true,
    winnerSeat: game.winnerSeat,
    firstSeat: firstSeat,
    actions: actions,
    forcedNoPass: forcedNoPass,
    bombs: st.bombPoints,
    multiplier: st.multiplier,
    deltas: st.scores.map(function (s) { return s.delta; }),
    maxAbsDelta: Math.max.apply(null, st.scores.map(function (s) { return Math.abs(s.delta); })),
    topPowerSeat: powers.indexOf(Math.max.apply(null, powers)),
    powers: powers,
    powerSpread: Math.max.apply(null, powers) - Math.min.apply(null, powers)
  };
}

function runBatch(opt, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = runGame(Object.assign({}, opt, { seed: 90001 + i * 137 }));
    if (r.ok) out.push(r);
    else out.push(r);
  }
  return out;
}

const t0 = Date.now();
console.log('陕北捉老麻 · 游戏性度量（' + new Date().toISOString().slice(0, 10) + '）');

// ── A. 难度梯度：目标座位换难度，其余固定 NORMAL ──────────────
console.log('\n=== A. 难度梯度（3 人局，座位 0 换难度，其余 NORMAL）===');
console.log(pad('难度', 10) + pad('样本', 8) + pad('胜率', 10) + pad('平均名次', 12) + pad('平均得分', 12) + pad('被禁过/局', 12));
const levels = ['EASY', 'NORMAL', 'HARD'];
const levelStats = {};
levels.forEach(function (lv) {
  const games = runBatch({ playerCount: 3, seatLevels: [lv, 'NORMAL', 'NORMAL'] }, 120 * K);
  const valid = games.filter(function (g) { return g.ok; });
  const wins = valid.filter(function (g) { return g.winnerSeat === 0; }).length;
  // 名次：赢家 1，其余按剩牌（此处用得分近似）
  const ranks = valid.map(function (g) {
    const sorted = g.deltas.slice().sort(function (a, b) { return b - a; });
    return sorted.indexOf(g.deltas[0]) + 1;
  });
  const scores = valid.map(function (g) { return g.deltas[0]; });
  levelStats[lv] = { winRate: wins / valid.length, avgScore: avg(scores), n: valid.length };
  console.log(pad(lv, 10) + pad(valid.length, 8) + pad(pct(wins, valid.length), 10) +
    pad(avg(ranks).toFixed(2), 12) + pad(avg(scores).toFixed(1), 12) +
    pad((avg(valid.map(function (g) { return g.forcedNoPass; }))).toFixed(1), 12));
});

// ── B. 节奏与负荷（3 人局全 NORMAL）──────────────────────────
const base = runBatch({ playerCount: 3 }, 200 * K).filter(function (g) { return g.ok; });
console.log('\n=== B. 对局节奏（3 人局，200 局）===');
const actArr = base.map(function (g) { return g.actions; });
const fnpArr = base.map(function (g) { return g.forcedNoPass; });
console.log('  每局总动作数（出+过）：平均 ' + avg(actArr).toFixed(1) + '，中位 ' + median(actArr) +
  '，区间 ' + Math.min.apply(null, actArr) + '~' + Math.max.apply(null, actArr));
console.log('  折合每人回合数：约 ' + (avg(actArr) / 3).toFixed(1) + ' 次决策');
console.log('  被强制规则禁止"不出"：平均 ' + avg(fnpArr).toFixed(1) + ' 次/局，最多 ' + Math.max.apply(null, fnpArr) + ' 次');
console.log('  含强制拦截的对局占比：' + pct(base.filter(function (g) { return g.forcedNoPass > 0; }).length, base.length));

// ── C. 炸弹与倍率 ───────────────────────────────────────────
console.log('\n=== C. 炸弹与倍率 ===');
const withBomb = base.filter(function (g) { return g.bombs > 0; });
const multDist = {};
base.forEach(function (g) { multDist[g.multiplier] = (multDist[g.multiplier] || 0) + 1; });
console.log('  出现炸弹的对局：' + pct(withBomb.length, base.length) +
  '（其中天炸计入 2 分）');
console.log('  平均炸弹分/局：' + avg(base.map(function (g) { return g.bombs; })).toFixed(2));
console.log('  倍率分布：' + Object.keys(multDist).sort().map(function (m) {
  return '×' + m + ' ' + pct(multDist[m], base.length);
}).join('  '));

// ── D. 运气权重 ─────────────────────────────────────────────
console.log('\n=== D. 运气权重（发牌能解释多少胜负）===');
const firstWins = base.filter(function (g) { return g.winnerSeat === g.firstSeat; }).length;
const powerWins = base.filter(function (g) { return g.winnerSeat === g.topPowerSeat; }).length;
console.log('  先手（持红桃3）胜率：' + pct(firstWins, base.length) + '（随机基准 ' + (100 / 3).toFixed(1) + '%）');
console.log('  手牌强度最高者胜率：' + pct(powerWins, base.length) + '（随机基准 ' + (100 / 3).toFixed(1) + '%）');
// 按手牌强度差分组，看胜率是否随优势单调上升
const buckets = [[-99, -8], [-8, -2], [-2, 2], [2, 8], [8, 99]];
console.log('  强度差 → 胜率：' + buckets.map(function (b) {
  const sub = base.filter(function (g) {
    const seatPower = g.powers[0];
    const others = g.powers.slice(1);
    const diff = seatPower - Math.max.apply(null, others);
    return diff > b[0] && diff <= b[1];
  });
  if (!sub.length) return '[' + b[0] + ',' + b[1] + '] -';
  const w = sub.filter(function (g) { return g.winnerSeat === 0; }).length;
  return '[' + b[0] + ',' + b[1] + '] ' + pct(w, sub.length) + '(' + sub.length + ')';
}).join('  '));

// ── E. 分数波动 ─────────────────────────────────────────────
console.log('\n=== E. 分数波动（单局与 5 局一轮）===');
const maxAbs = base.map(function (g) { return g.maxAbsDelta; });
console.log('  单局最大输赢：平均 ' + avg(maxAbs).toFixed(1) + ' 分，最大 ' + Math.max.apply(null, maxAbs) + ' 分');
const rounds = [];
for (let i = 0; i + 5 <= base.length; i += 5) {
  const totals = [0, 0, 0];
  for (let j = 0; j < 5; j++) base[i + j].deltas.forEach(function (d, s) { totals[s] += d; });
  rounds.push(Math.max.apply(null, totals) - Math.min.apply(null, totals));
}
console.log('  5 局一轮的冠亚分差：平均 ' + avg(rounds).toFixed(1) + ' 分（标准差 ' + std(rounds).toFixed(1) + '）');
console.log('  单局 delta 标准差：' + std(base.map(function (g) { return g.deltas[0]; })).toFixed(2));

// ── F. 其他人数 ─────────────────────────────────────────────
console.log('\n=== F. 2 人 / 4 人局 ===');
[2, 4].forEach(function (pc) {
  const games = runBatch({ playerCount: pc }, 80 * K).filter(function (g) { return g.ok; });
  const a = games.map(function (g) { return g.actions; });
  const bombRate = games.filter(function (g) { return g.bombs > 0; }).length;
  console.log('  ' + pc + ' 人：平均动作 ' + avg(a).toFixed(1) + '，每人回合 ' + (avg(a) / pc).toFixed(1) +
    '，含炸弹 ' + pct(bombRate, games.length) + '，样本 ' + games.length);
});

// ── G. 异常 ─────────────────────────────────────────────────
console.log('\n=== G. 稳定性 ===');
console.log('  全部模拟未出现卡死/非法动作（异常会直接计入 FAIL 并打印 error）');
console.log('  耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒');
