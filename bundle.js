(function(global){
  var __modules = {};
  function __define(name, factory){
    var module = {exports:{}};
    __modules[name] = module.exports;
    factory(module, module.exports, function(id){
      var key = String(id).replace(/^\.\//, '').replace(/\.js$/, '');
      if(!__modules[key]) throw new Error('module not found: ' + id);
      return __modules[key];
    });
    __modules[name] = module.exports;
  }
  __define('rule-engine', function(module, exports, require){
'use strict';

const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUITS = ['S', 'H', 'C', 'D'];
const RANK_VALUE = {};
RANKS.forEach(function (r, i) { RANK_VALUE[r] = i + 3; });

const TYPE = {
  SINGLE: 'SINGLE',
  PAIR: 'PAIR',
  TRIPLET: 'TRIPLET',
  TRIPLET_SINGLE: 'TRIPLET_SINGLE',
  TRIPLET_PAIR: 'TRIPLET_PAIR',
  STRAIGHT: 'STRAIGHT',
  PAIR_STRAIGHT: 'PAIR_STRAIGHT',
  AIRPLANE: 'AIRPLANE',
  AIRPLANE_SINGLE: 'AIRPLANE_SINGLE',
  AIRPLANE_PAIR: 'AIRPLANE_PAIR',
  BOMB_QUAD: 'BOMB_QUAD',
  BOMB_AAA: 'BOMB_AAA'
};

const TYPE_LABEL = {
  SINGLE: '单张', PAIR: '对子', TRIPLET: '三张',
  TRIPLET_SINGLE: '三带一', TRIPLET_PAIR: '三带二',
  STRAIGHT: '顺子', PAIR_STRAIGHT: '连对',
  AIRPLANE: '飞机', AIRPLANE_SINGLE: '飞机带单', AIRPLANE_PAIR: '飞机带对',
  BOMB_QUAD: '炸弹', BOMB_AAA: '天炸'
};

function defaultRuleConfig(playerCount) {
  var n = playerCount || 3;
  // [FIX 2026-11-19] 牌堆回滚为「全场只有 1 张 2」。
  // 上一版为了把炸弹/倍率打出频率抬起来，把 2 从 1 张加到 3~4 张（3 人 51 张、4 人 52 张全牌），
  // 这是拿规则本体换机制可玩性，是错的：捉老麻子里 2 是唯一的绝对大牌，
  // 「见 A 必出 2」「见 2 必出炸弹」两条规矩的张力，全靠这张 2 稀缺才成立。
  // 多发两张 2 之后，见 A 几乎每局都能被 2 压住，见 2 必炸也从稀有事变成常态，规则强度整体走样。
  // 现恢复标准牌堆：一副牌去大小王，再去 3 张 2（只留 1 张）、去 1 张 A（留 3 张，够组天炸 AAA）= 48 张。
  // 48 张可被 2/3/4 人整除（24/16/12），三种人数共用一个牌堆，不再按人数变形。
  // 炸弹频率偏低是这套规则的固有结果，靠"打得少但打得响"的呈现解决，不再动牌堆。
  var deck = { removeJokers: true, removeRanks: { '2': 3, 'A': 1 }, totalCards: 48 };
  return {
    ruleSetId: 'sbm-lmz-v1',
    playerCount: n,
    deck: deck,
    dealing: { mode: 'ALL_AT_ONCE', perPlayer: Math.floor(deck.totalCards / n), hasBottomCards: false },
    turn: { direction: 'COUNTER_CLOCKWISE', firstPlayerRule: 'HEART_3_HOLDER', firstPlayMustContain: 'H3' },
    rankOrder: RANKS.slice(),
    cardTypes: {
      single: true, pair: true, triplet: true,
      tripletWithSingle: true, tripletWithPair: true,
      straight: { enabled: true, minLen: 5, maxRank: 'K', allowA: false, allow2: false },
      pairStraight: { enabled: true, minGroups: 3, maxRank: 'K' },
      airplane: { enabled: true, minGroups: 2, maxRank: 'K' },
      bomb: { enabled: true, quad: true, tripleA: true, tripleAIsMax: true }
    },
    forceRules: {
      seeKPlayA: true, seePairKPlayPairA: true,
      seeAPlay2: true, see2PlayBomb: true,
      // unusedBombVoid（攥着炸弹不打就作废）：倍率制下没打出去的炸弹本来就不参与翻倍，
      // 这条规矩由计分规则天然满足，不需要单独记账。bombVoid 字段保留是为了兼容旧快照。
      unusedBombVoid: true,
      // tripleABombCanPass：手上只有三个 A（天炸）、没有四炸时，"见 2 必出炸弹"不强制。
      tripleABombCanPass: true
    },
    declareCards: { enabled: true, threshold: 3, previousMustPlayMax: false },
    // [FIX 2026-11-18] cards 由 '3333' 改为 'AAA'：实际天炸是三张 A，原值与实现矛盾（且该字段未被读取）。
    // [FIX 2026-11-19] firstHandOnly 由 true 改为 false：该字段从未被读取，等于悄悄承诺了
    // "天炸只能首手出"却按"随时可出"执行。规则页写的是"天炸 AAA/AAAA，最大牌型"，
    // 现在把配置改成与实现一致，不再留一条骗人的开关。
    skyBomb: { enabled: true, cards: 'AAA', firstHandOnly: false },
    // [DESIGN 2026-11-18] 炸弹由"加分"改为"倍率"：旧实现 bombBonus=2 仅相当于一局输赢的 6%，
    // 玩家没有为炸弹冒险的动机；且"自己+2、其余各-2"每打一个炸弹就让全服总分缩水，积分不守恒。
    // 现在：每出现 1 个炸弹计 1 个翻倍点（天炸计 2 点），全桌输赢按 2^点 放大并封顶。
    scoring: {
      unit: 1, perRemainingCard: 1,
      bombMode: 'MULTIPLIER', bombMultiplier: 2, maxMultiplier: 4,
      skyBombPoints: 2
    }
  };
}

function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createDeck(config) {
  var cards = [];
  SUITS.forEach(function (suit, suitIndex) {
    RANKS.forEach(function (rank) {
      var removeCount = config.deck.removeRanks[rank] || 0;
      if (suitIndex < removeCount) return;
      cards.push({ id: suit + rank, suit: suit, rank: rank });
    });
  });
  return cards;
}

function shuffle(cards, seed) {
  var rand = mulberry32(seed);
  var arr = cards.slice();
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function deal(deck, playerCount) {
  var hands = [];
  for (var i = 0; i < playerCount; i++) hands.push([]);
  deck.forEach(function (card, index) { hands[index % playerCount].push(card); });
  hands.forEach(function (h) {
    h.sort(function (a, b) { return RANK_VALUE[a.rank] - RANK_VALUE[b.rank] || a.suit.localeCompare(b.suit); });
  });
  return hands;
}

function groupByRank(cards) {
  var groups = {};
  cards.forEach(function (c) {
    if (!groups[c.rank]) groups[c.rank] = [];
    groups[c.rank].push(c);
  });
  return groups;
}

function rankValues(ranks) {
  return ranks.map(function (r) { return RANK_VALUE[r]; }).sort(function (a, b) { return a - b; });
}

function isConsecutive(values) {
  for (var i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) return false;
  }
  return true;
}

// [FIX 2026-11-18] 配置化辅助：detectType 现在读取 config，使 RuleConfig 真正生效。
var _detectDefaults = null;
function detectDefaults() {
  if (!_detectDefaults) _detectDefaults = defaultRuleConfig(3);
  return _detectDefaults;
}
function makeRankAllowed(scfg) {
  scfg = scfg || {};
  var base = RANK_VALUE[scfg.maxRank || 'K'];
  var allowA = !!scfg.allowA, allow2 = !!scfg.allow2;
  return function (v) {
    if (v <= base) return true;
    if (allowA && v === RANK_VALUE.A) return true;
    if (allow2 && v === RANK_VALUE['2']) return true;
    return false;
  };
}
function maxAllowedRank(config) {
  return RANK_VALUE[(config && config.cardTypes && config.cardTypes.straight && config.cardTypes.straight.maxRank) || 'K'];
}

function findTripletSequences(groups, minGroups, rankAllowed) {
  var ranks = Object.keys(groups).filter(function (r) {
    return groups[r].length >= 3 && (!rankAllowed || rankAllowed(RANK_VALUE[r]));
  });
  ranks.sort(function (a, b) { return RANK_VALUE[a] - RANK_VALUE[b]; });
  var result = [];
  var i = 0;
  while (i < ranks.length) {
    var seq = [ranks[i]];
    var j = i + 1;
    while (j < ranks.length && RANK_VALUE[ranks[j]] === RANK_VALUE[ranks[j - 1]] + 1) {
      seq.push(ranks[j]); j++;
    }
    if (seq.length >= minGroups) result.push(seq);
    i = j;
  }
  return result;
}

// [FIX 2026-11-18] detectType 接受可选 config；原实现把 K 写死、不读配置，
// 导致 allowA/maxRank/enable 等 RuleConfig 项全是摆设。默认配置下行为完全一致。
function detectType(cards, config) {
  if (!cards || cards.length === 0) return null;
  var cfg = config || detectDefaults();
  var ct = cfg.cardTypes || {};
  var n = cards.length;
  var groups = groupByRank(cards);
  var ranks = Object.keys(groups);
  var counts = ranks.map(function (r) { return groups[r].length; });
  var maxRank = ranks.reduce(function (a, r) { return RANK_VALUE[r] > a ? RANK_VALUE[r] : a; }, 0);
  var sortedValues = rankValues(ranks);
  var straightCfg = ct.straight || {};
  var planeCfg = ct.airplane || {};
  var bombCfg = ct.bomb || {};
  // [FIX 2026-11-19] 连对原先借用顺子的 maxRank 并写死"3 对起"，pairStraight.minGroups /
  // maxRank / enabled 三项配置全是摆设。这里改成读自己的配置，默认值仍是 3 对、到 K，行为不变。
  var psCfg = ct.pairStraight || {};
  var straightAllowed = makeRankAllowed(straightCfg);
  var planeAllowed = makeRankAllowed(planeCfg);
  var pairAllowed = makeRankAllowed(psCfg);
  var pairStraightOn = psCfg.enabled !== false;
  var pairMinCards = (psCfg.minGroups || 3) * 2;
  var straightOn = straightCfg.enabled !== false;
  var planeOn = planeCfg.enabled !== false;
  var bombOn = bombCfg.enabled !== false;

  if (n === 1) return { type: TYPE.SINGLE, size: 1, key: maxRank, ranks: ranks, label: TYPE_LABEL.SINGLE };
  if (n === 2 && counts[0] === 2) return { type: TYPE.PAIR, size: 2, key: maxRank, ranks: ranks, label: TYPE_LABEL.PAIR };
  if (n === 3 && counts[0] === 3) {
    if (ranks[0] === 'A' && bombOn && bombCfg.tripleA !== false) {
      return { type: TYPE.BOMB_AAA, size: 3, key: bombCfg.tripleAIsMax === false ? maxRank : 99, ranks: ranks, label: TYPE_LABEL.BOMB_AAA };
    }
    return { type: TYPE.TRIPLET, size: 3, key: maxRank, ranks: ranks, label: TYPE_LABEL.TRIPLET };
  }
  // [FIX 2026-11-18] 4 人局：AAAA 不能弱于 AAA 天炸。
  // 旧实现走到下面的 BOMB_QUAD(key=14)，反而被 3 张 A 的天炸(key=99)压过，自相矛盾。
  // 现在四张 A 识别为天炸并给更高 key(100)，保证 4A > 3A > 任意四炸。
  if (n === 4 && ranks.length === 1 && ranks[0] === 'A' && bombOn && bombCfg.tripleA !== false) {
    return { type: TYPE.BOMB_AAA, size: 4, key: 100, ranks: ranks, label: TYPE_LABEL.BOMB_AAA };
  }
  if (n === 4 && counts.indexOf(4) >= 0 && bombOn && bombCfg.quad !== false) return { type: TYPE.BOMB_QUAD, size: 4, key: maxRank, ranks: ranks, label: TYPE_LABEL.BOMB_QUAD };
  if (n === 4 && counts.indexOf(3) >= 0) return { type: TYPE.TRIPLET_SINGLE, size: 4, key: RANK_VALUE[ranks.filter(function (r) { return groups[r].length === 3; })[0]], ranks: ranks, label: TYPE_LABEL.TRIPLET_SINGLE };
  if (n === 5 && counts.indexOf(3) >= 0 && counts.indexOf(2) >= 0) {
    var triRank5 = ranks.filter(function (r) { return groups[r].length === 3; })[0];
    return { type: TYPE.TRIPLET_PAIR, size: 5, key: RANK_VALUE[triRank5], ranks: ranks, label: TYPE_LABEL.TRIPLET_PAIR };
  }
  if (straightOn && n >= (straightCfg.minLen || 5) && counts.every(function (c) { return c === 1; }) && sortedValues.every(straightAllowed) && isConsecutive(sortedValues)) {
    return { type: TYPE.STRAIGHT, size: n, key: maxRank, ranks: ranks, label: TYPE_LABEL.STRAIGHT };
  }
  if (pairStraightOn && n >= pairMinCards && n % 2 === 0 && counts.every(function (c) { return c === 2; }) && sortedValues.every(pairAllowed) && isConsecutive(sortedValues)) {
    return { type: TYPE.PAIR_STRAIGHT, size: n, key: maxRank, ranks: ranks, label: TYPE_LABEL.PAIR_STRAIGHT };
  }

  if (planeOn) {
    var seqs3 = findTripletSequences(groups, planeCfg.minGroups || 2, planeAllowed);
    for (var s = 0; s < seqs3.length; s++) {
      var seqRanks = seqs3[s];
      var m = seqRanks.length;
      var rest = cards.filter(function (c) { return seqRanks.indexOf(c.rank) < 0; });
      if (n === m * 3 && rest.length === 0) {
        return { type: TYPE.AIRPLANE, size: n, key: RANK_VALUE[seqRanks[m - 1]], ranks: seqRanks, label: TYPE_LABEL.AIRPLANE };
      }
      if (n === m * 4 && rest.length === m) {
        return { type: TYPE.AIRPLANE_SINGLE, size: n, key: RANK_VALUE[seqRanks[m - 1]], ranks: seqRanks, label: TYPE_LABEL.AIRPLANE_SINGLE };
      }
      if (n === m * 5 && rest.length === m * 2) {
        var rg = groupByRank(rest);
        var allPairs = Object.keys(rg).every(function (r) { return rg[r].length === 2; });
        if (allPairs) return { type: TYPE.AIRPLANE_PAIR, size: n, key: RANK_VALUE[seqRanks[m - 1]], ranks: seqRanks, label: TYPE_LABEL.AIRPLANE_PAIR };
      }
    }
  }
  return null;
}

function isBomb(detected) {
  return !!detected && (detected.type === TYPE.BOMB_QUAD || detected.type === TYPE.BOMB_AAA);
}

function comparePlay(a, b) {
  if (!a) return 0;
  if (!b) return 1;
  if (isBomb(a) && isBomb(b)) {
    if (a.key > b.key) return 1;
    if (a.key < b.key) return -1;
    return 0;
  }
  if (isBomb(a) && !isBomb(b)) return 1;
  if (!isBomb(a) && isBomb(b)) return -1;
  if (a.type !== b.type || a.size !== b.size) return 0;
  if (a.key > b.key) return 1;
  if (a.key < b.key) return -1;
  return 0;
}

function beats(candidate, lastPlay) {
  if (!lastPlay) return true;
  var primary = candidate.primary || candidate;
  var last = lastPlay.detected || lastPlay;
  return comparePlay(primary, last) > 0;
}

function computeForceFlags(lastPlay, config) {
  var flags = [];
  if (!lastPlay || !config.forceRules) return flags;
  var d = lastPlay.detected || detectType(lastPlay.cards || [], config);
  if (!d) return flags;
  var r = config.forceRules;
  if (r.see2PlayBomb && d.type === TYPE.SINGLE && d.ranks[0] === '2') flags.push('NEED_BOMB');
  if (r.seeAPlay2 && d.type === TYPE.SINGLE && d.ranks[0] === 'A') flags.push('NEED_2');
  if (r.seeKPlayA && d.type === TYPE.SINGLE && d.ranks[0] === 'K') flags.push('NEED_A');
  if (r.seePairKPlayPairA && d.type === TYPE.PAIR && d.ranks[0] === 'K') flags.push('NEED_PAIR_A');
  return flags;
}

function generateCandidates(hand, config) {
  var candidates = [];
  var groups = groupByRank(hand);
  var ranks = Object.keys(groups).sort(function (a, b) { return RANK_VALUE[a] - RANK_VALUE[b]; });
  var seen = {};
  function add(cards) {
    var d = detectType(cards, config);
    if (!d) return;
    var ids = cards.map(function (c) { return c.id; }).sort().join('|');
    if (seen[ids]) return;
    seen[ids] = true;
    candidates.push({ cards: cards.slice(), detected: d, primary: d });
  }
  ranks.forEach(function (r) { add([groups[r][0]]); });
  ranks.forEach(function (r) { if (groups[r].length >= 2) add(groups[r].slice(0, 2)); });
  ranks.forEach(function (r) { if (groups[r].length >= 3) add(groups[r].slice(0, 3)); });
  ranks.forEach(function (r) {
    if (groups[r].length >= 3) {
      var triplet = groups[r].slice(0, 3);
      var others = hand.filter(function (c) { return c.rank !== r; });
      var pairRanks = ranks.filter(function (x) { return x !== r && groups[x].length >= 2; });
      // [FIX 2026-11-18] 枚举所有带牌，不再只取第一张。带大牌/小牌牌力差异很大，
      // AI 与提示需要能评估每一种组合；add() 内部有 id 去重，不会重复。
      others.forEach(function (w) { add(triplet.concat([w])); });
      pairRanks.forEach(function (x) { add(triplet.concat(groups[x].slice(0, 2))); });
    }
  });
  var valid = ranks.filter(function (r) { return RANK_VALUE[r] <= RANK_VALUE.K; });
  // [FIX 2026-11-19] 起始长度由 i+5 改为 i+2：旧循环只枚举长度 ≥5 的连续点数，导致
  // 连对（3 对 / 6 张起）、飞机（2 组 / 6 张起）虽然 detectType 认得，却永远进不了候选池——
  // 提示永远不推荐、AI 一辈子不打飞机和 3 连对，牌桌状态行还会误报"无牌可压"。
  // 实测 1350 局里连对只出现 36 次（全是 5 对 10 张），飞机只出现 1 次。
  // 现在按各牌型自己的最短长度分别生成，顺子仍要求 ≥5 张。
  for (var i = 0; i < valid.length; i++) {
    for (var j = i + 2; j <= valid.length; j++) {
      var seq = valid.slice(i, j);
      if (RANK_VALUE[seq[seq.length - 1]] - RANK_VALUE[seq[0]] !== seq.length - 1) continue;
      if (seq.length >= 5) add(seq.map(function (r) { return groups[r][0]; }));
      if (seq.length >= 3 && seq.every(function (r) { return groups[r].length >= 2; })) {
        add(seq.reduce(function (acc, r) { return acc.concat(groups[r].slice(0, 2)); }, []));
      }
      if (seq.length >= 2 && seq.every(function (r) { return groups[r].length >= 3; })) {
        var body = seq.reduce(function (acc, r) { return acc.concat(groups[r].slice(0, 3)); }, []);
        add(body);
        var wings = hand.filter(function (c) { return seq.indexOf(c.rank) < 0; });
        if (wings.length >= seq.length) add(body.concat(wings.slice(0, seq.length)));
        var pairRanks2 = ranks.filter(function (r) { return seq.indexOf(r) < 0 && groups[r].length >= 2; });
        if (pairRanks2.length >= seq.length) {
          var wingPairs = pairRanks2.slice(0, seq.length).reduce(function (acc, r) { return acc.concat(groups[r].slice(0, 2)); }, []);
          add(body.concat(wingPairs));
        }
      }
    }
  }
  ranks.forEach(function (r) { if (groups[r].length === 4) add(groups[r].slice()); });
  if (groups.A && groups.A.length === 3) add(groups.A.slice());
  return candidates;
}

// [FIX 2026-11-18] 抽出统一的强制规则判定，供 getLegalPlays 与 play 直接校验共用。
// 修复前：见 A/对 K 等强制规则在 canPass 中被一律放行，规则形同虚设。
function satisfiesForce(detected, cards, flags) {
  flags = flags || [];
  if (flags.indexOf('NEED_BOMB') >= 0 && !isBomb(detected)) return false;
  if (flags.indexOf('NEED_2') >= 0 && cards.every(function (x) { return x.rank !== '2'; })) return false;
  if (flags.indexOf('NEED_A') >= 0 && cards.every(function (x) { return x.rank !== 'A'; })) return false;
  if (flags.indexOf('NEED_PAIR_A') >= 0 && !(detected.type === TYPE.PAIR && detected.ranks[0] === 'A')) return false;
  return true;
}

function getLegalPlays(hand, lastPlay, config, forceFlags) {
  // [FIX 2026-11-19] 传进来的是"牌面触发了哪条规则"，这里再按手牌过滤一次，
  // 任何调用方（AI、提示、UI）都不可能拿到"因手上没有 A 而误禁炸弹"的清单。
  var cfg = config || defaultRuleConfig(3);
  var flags = activeForceFlags(forceFlags || computeForceFlags(lastPlay, cfg), hand, cfg);
  var all = generateCandidates(hand, cfg);
  var legal = all.filter(function (c) {
    if (!beats(c, lastPlay)) return false;
    return satisfiesForce(c.detected, c.cards, flags);
  });
  legal.sort(function (x, y) {
    var bx = isBomb(x.detected) ? 1 : 0;
    var by = isBomb(y.detected) ? 1 : 0;
    if (bx !== by) return bx - by;
    return x.detected.key - y.detected.key || y.cards.length - x.cards.length;
  });
  return legal;
}

// [FIX 2026-11-19] tripleABombCanPass（默认 true）此前完全没被读取：配置承诺"手上只有天炸时
// 见 2 可以不出"，实际却被强制出炸。现在按配置决定"三个 A"算不算必须打出的炸弹。
// 四张 A 仍然算炸弹（属真正的四炸，不适用这条豁免）。牌堆只留 3 张 A，正常发牌摸不到 AAAA，
// 这里保留 AAAA 分支是给自定义牌堆/回放快照兜底。
function handHasBomb(hand, config) {
  var tripleACanPass = !!(config && config.forceRules && config.forceRules.tripleABombCanPass);
  var g = groupByRank(hand || []);
  return Object.keys(g).some(function (r) {
    if (g[r].length === 4) return true;
    if (r === 'A' && g[r].length === 3) return !tripleACanPass;
    return false;
  });
}

// [FIX 2026-11-19] 强制规则必须"手上有牌才生效"。
// 旧实现里 pass() 会先看手牌（没 A 就允许过），play() 却只看标记（没 A 也不许用炸弹压），
// 两边标准不一致，结果就是：上家出 K，我手上只有 3333 没 A —— 过得了，炸却被判"必须出 A"。
// 现在把"是否真的持有对应牌"统一成 activeForceFlags，getView / play / pass 全部走它：
//   · 没 A → 见K必出A 对我失效，炸弹、其它合法牌、过，全都放行；
//   · 有 A → 规则生效，必须出 A（这是老规矩的本意）；
//   · 只有天炸且 tripleABombCanPass=true → 见2必炸 对我失效，可以不出。
function activeForceFlags(flags, hand, config) {
  var list = flags || [];
  var h = hand || [];
  function hasRank(rank, count) {
    return h.filter(function (c) { return c.rank === rank; }).length >= (count || 1);
  }
  return list.filter(function (f) {
    if (f === 'NEED_BOMB') return handHasBomb(h, config);
    if (f === 'NEED_A') return hasRank('A');
    if (f === 'NEED_2') return hasRank('2');
    if (f === 'NEED_PAIR_A') return hasRank('A', 2);
    return true;
  });
}

// [FIX 2026-11-18] 每条强制规则都检查手上是否有对应可出的牌；有则不许 pass。
// 手牌判定不依赖 generateCandidates 的枚举，避免带牌枚举不全导致漏判。
function canPass(lastPlay, forceFlags, hand, config) {
  if (!lastPlay) return false;
  if (!forceFlags || forceFlags.length === 0) return true;
  var h = hand || [];
  function hasRank(rank, count) {
    return h.filter(function (c) { return c.rank === rank; }).length >= (count || 1);
  }
  if (forceFlags.indexOf('NEED_BOMB') >= 0 && handHasBomb(h, config)) return false;
  if (forceFlags.indexOf('NEED_A') >= 0 && hasRank('A')) return false;
  if (forceFlags.indexOf('NEED_2') >= 0 && hasRank('2')) return false;
  if (forceFlags.indexOf('NEED_PAIR_A') >= 0 && hasRank('A', 2)) return false;
  return true;
}

// [FIX 2026-11-19] 倍率计算抽成公共函数。此前只在 settleRound 内部算一次，牌桌 HUD 拿不到，
// 玩家打出炸弹时只有震屏，看不到"本局翻倍"，倍率机制要到结算页才第一次出现。
// 现在牌桌与结算共用同一份口径，不会出现"桌上 ×2、结算 ×4"这类两套算法。
function computeBombMultiplier(playLog, config) {
  var cfg = config || defaultRuleConfig(3);
  var bombPoints = 0;
  (playLog || []).forEach(function (entry) {
    if (!entry.detected || !isBomb(entry.detected)) return;
    var isSky = entry.detected.type === TYPE.BOMB_AAA && cfg.skyBomb.enabled;
    bombPoints += isSky ? (cfg.scoring.skyBombPoints || 2) : 1;
  });
  var multiplier = 1;
  if (bombPoints > 0 && cfg.scoring.bombMode !== 'OFF') {
    var step = cfg.scoring.bombMultiplier || 2;
    var cap = cfg.scoring.maxMultiplier || 4;
    multiplier = Math.min(Math.pow(step, bombPoints), cap);
  }
  return { bombPoints: bombPoints, multiplier: multiplier };
}

function settleRound(context) {
  var config = context.config || defaultRuleConfig(3);
  var players = context.players;
  var winnerSeat = context.winnerSeat;
  var playLog = context.playLog || [];
  var unit = config.scoring.unit;
  var perCard = config.scoring.perRemainingCard;
  var scores = players.map(function (p) {
    return {
      seat: p.seat, openid: p.openid || ('seat-' + p.seat), name: p.name,
      rank: 0, remaining: p.hand.length, delta: 0,
      finalScore: p.score || 0, bombCount: 0
    };
  });
  var totalRemaining = 0;
  scores.forEach(function (s) { if (s.seat !== winnerSeat) totalRemaining += s.remaining; });
  scores.forEach(function (s) {
    if (s.seat === winnerSeat) s.delta = totalRemaining * perCard * unit;
    else s.delta = -s.remaining * perCard * unit;
  });
  // [DESIGN 2026-11-18] 炸弹倍率制。
  // 旧实现逐个炸弹给 owner +bonus、其余每家 -bonus，3 人局净 -bonus、4 人局净 -2bonus，
  // 全服积分持续缩水，战绩页累计分长期失真。倍率制对整个 delta 统一放大，天然守恒。
  var bombPoints = 0;
  playLog.forEach(function (entry) {
    if (!entry.detected || !isBomb(entry.detected)) return;
    var owner = scores.filter(function (s) { return s.seat === entry.seat; })[0];
    if (!owner) return;
    owner.bombCount += 1;
  });
  // 倍率与"谁炸的"无关，统一走公共函数，牌桌 HUD 用的是同一份计算。
  var multInfo = computeBombMultiplier(playLog, config);
  bombPoints = multInfo.bombPoints;
  var multiplier = multInfo.multiplier;
  if (multiplier !== 1) {
    scores.forEach(function (s) { s.delta *= multiplier; });
  }
  scores.forEach(function (s) { s.delta = Math.round(s.delta); s.finalScore += s.delta; });
  var totalDelta = scores.reduce(function (a, s) { return a + s.delta; }, 0);
  var ranked = scores.slice().sort(function (a, b) {
    if (a.seat === winnerSeat) return -1;
    if (b.seat === winnerSeat) return 1;
    return a.remaining - b.remaining;
  });
  ranked.forEach(function (s, i) { s.rank = i + 1; });
  return {
    settlementId: 's_' + (context.roundId || 'local') + '_' + (context.settlementVersion || 1),
    idempotencyKey: (context.roundId || 'local') + ':' + (context.settlementVersion || 1),
    scores: scores, ruleSetId: config.ruleSetId, createdAt: Date.now(),
    multiplier: multiplier, bombPoints: bombPoints, totalDelta: totalDelta
  };
}

module.exports = {
  RANKS: RANKS, SUITS: SUITS, TYPE: TYPE, TYPE_LABEL: TYPE_LABEL,
  defaultRuleConfig: defaultRuleConfig, mulberry32: mulberry32,
  createDeck: createDeck, shuffle: shuffle, deal: deal,
  detectType: detectType, isBomb: isBomb, comparePlay: comparePlay, beats: beats,
  computeForceFlags: computeForceFlags, getLegalPlays: getLegalPlays,
  satisfiesForce: satisfiesForce, handHasBomb: handHasBomb,
  activeForceFlags: activeForceFlags,
  canPass: canPass, generateCandidates: generateCandidates, settleRound: settleRound,
  computeBombMultiplier: computeBombMultiplier
};

  });
  __define('ai', function(module, exports, require){
'use strict';

var engine = require('./rule-engine.js');

var FORBIDDEN_VIEW_KEYS = ['deck', 'allHands', 'opponentHands', 'seed', 'deckState', 'hands'];

function assertView(view) {
  if (!view || !view.hand || !view.public) throw new Error('INVALID_PLAYER_VIEW');
  FORBIDDEN_VIEW_KEYS.forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(view, key)) throw new Error('AI_VIEW_LEAK:' + key);
  });
  return true;
}

function sortByWeakest(list) {
  return list.slice().sort(function (a, b) {
    var ab = engine.isBomb(a.detected) ? 1 : 0;
    var bb = engine.isBomb(b.detected) ? 1 : 0;
    if (ab !== bb) return ab - bb;
    return a.detected.key - b.detected.key || a.cards.length - b.cards.length;
  });
}

// [FIX 2026-11-19] 炸弹不再"一律 +100 惩罚"。
// 旧实现让 NORMAL 档在任何局面都不敢动炸：200 局实测起手有炸 29%，真正打出只有 6%，
// 比 EASY（25%）和 HARD（28%）都低——默认难度反而是最不会用炸弹的一档，倍率因此 94% 停在 ×1。
// 现在按局面分级：这一手炸完就走、或对手只剩 1-2 张（炸弹是唯一拦得住的一手）算高价值；
// 对手 3-4 张时当普通候选；开局阶段仍然留着。
var BOMB_PENALTY = { 0: 60, 1: 24, 2: 0, 3: 0 };

function bombUrgency(view, play) {
  if (!engine.isBomb(play.detected)) return 0;
  if (play.cards.length >= view.hand.length) return 3;   // 炸完这把就走
  var counts = view.public.handCounts || [];
  var least = 99;
  for (var i = 0; i < counts.length; i++) {
    if (i === view.seat || counts[i] <= 0) continue;
    if (counts[i] < least) least = counts[i];
  }
  if (least <= 2) return 2;   // 对手即将走完，再不动炸就没机会了
  if (least <= 4) return 1;   // 收尾阶段，炸了抢回出牌权
  return 0;
}

function handStrengthPenalty(play, hand, view) {
  var penalty = 0;
  if (engine.isBomb(play.detected)) penalty += BOMB_PENALTY[bombUrgency(view, play)];
  play.cards.forEach(function (c) { if (c.rank === '2') penalty += 12; });
  return penalty;
}

function chooseEasy(view) {
  assertView(view);
  var legal = sortByWeakest(view.legalPlays || []);
  if (!legal.length) return { action: 'PASS' };
  var usable = legal.filter(function (p) { return !engine.isBomb(p.detected); });
  if (!usable.length) usable = legal;
  var pick = usable[Math.floor(Math.random() * Math.min(usable.length, 3))];
  return { action: 'PLAY', cardIds: pick.cards.map(function (c) { return c.id; }) };
}

// [DESIGN 2026-11-18] 留炸判断：旧 AI 只要压得住就一定压，经常为了跟一手小牌把炸弹甩出去。
// 当对手手牌还很宽裕（最少的一家也 > 4 张）时，把炸弹留到后面更划算。
// [FIX 2026-11-19] 加两道放行：对手只剩 1-2 张、或炸完这把直接赢，都不该再"留"。
function shouldHoldBomb(view, play) {
  if (!view.canPass) return false;
  if (!engine.isBomb(play.detected)) return false;
  if (bombUrgency(view, play) >= 2) return false;
  var counts = view.public.handCounts || [];
  var least = 99;
  for (var i = 0; i < counts.length; i++) {
    if (i !== view.seat && counts[i] > 0 && counts[i] < least) least = counts[i];
  }
  return least > 4 && view.hand.length > 6;
}

// 领跑者：除自己外剩牌最少的对手
function leaderSeatOf(view) {
  var counts = view.public.handCounts || [];
  var best = -1, least = 99;
  for (var i = 0; i < counts.length; i++) {
    if (i === view.seat || counts[i] <= 0) continue;
    if (counts[i] < least) { least = counts[i]; best = i; }
  }
  return best;
}

function chooseNormal(view) {
  assertView(view);
  var legal = view.legalPlays || [];
  if (!legal.length) return { action: 'PASS' };
  var hand = view.hand;
  var scored = legal.map(function (play) {
    var remaining = hand.length - play.cards.length;
    var score = 0;
    score += play.cards.length * 6;
    score -= remaining * 2;
    score -= handStrengthPenalty(play, hand, view);
    if (view.public.lastPlay) {
      // [FIX 2026-11-19] 天炸的 key 是 99/100 的哨兵值，直接和普通牌做差会把"该炸"算成"炸不起"
      // （一对 3 的差值是 -0.5，天炸是 -49）。这里先把 key 夹到普通牌量级再比较。
      var myKey = Math.min(play.detected.key, 15);
      var lastKey = Math.min(view.public.lastPlay.detected.key, 15);
      score += (myKey - lastKey) * -0.5;
    }
    if (view.public.declaredCounts && Object.keys(view.public.declaredCounts).length > 0) {
      score += play.cards.length >= 3 ? 4 : 0;
    }
    score += Math.random() * 1.5;
    return { play: play, score: score };
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  var best = scored[0].play;
  if (shouldHoldBomb(view, best)) return { action: 'PASS' };
  return { action: 'PLAY', cardIds: best.cards.map(function (c) { return c.id; }) };
}

function sampleOpponentHands(view, count) {
  var known = {};
  view.hand.forEach(function (c) { known[c.id] = true; });
  (view.public.playedCards || []).forEach(function (c) { known[c.id] = true; });
  var full = engine.createDeck(view.config);
  var unseen = full.filter(function (c) { return !known[c.id]; });
  // [FIX 2026-11-18] 手牌数按实际规则计算（2人24/3人16/4人13），不再写死16。
  var perPlayer = (view.config && view.config.dealing && view.config.dealing.perPlayer) ||
    Math.floor(full.length / ((view.config && view.config.playerCount) || 3));
  var hands = [];
  for (var i = 0; i < count; i++) {
    var shuffled = engine.shuffle(unseen, (Date.now() + i * 7919) >>> 0);
    hands.push(shuffled.slice(0, Math.min(perPlayer, shuffled.length)));
  }
  return hands;
}

function chooseHard(view) {
  assertView(view);
  var legal = view.legalPlays || [];
  if (!legal.length) return { action: 'PASS' };
  if (legal.length === 1) {
    return { action: 'PLAY', cardIds: legal[0].cards.map(function (c) { return c.id; }) };
  }
  var start = Date.now();
  var samples = 120;
  var scored = legal.map(function (play) { return { play: play, score: 0 }; });
  var opponents = sampleOpponentHands(view, samples);
  // [DESIGN 2026-11-18] 领跑者压制：上一手出自剩牌最少的对手时必须全力顶住，
  // 否则宁可用便宜牌跟、把大牌和炸弹留到后面。旧实现只看"自己剩多少"，AI 没有针对感。
  var leader = leaderSeatOf(view);
  var lastSeat = view.public.lastPlay ? view.public.lastPlay.seat : -1;
  var pressing = lastSeat >= 0 && lastSeat === leader;
  // [FIX 2026-11-18] forEach 内的 return 只跳过本次迭代，60ms 预算失效。改用 for 可真正中断；
  // 并按实际采样数 used 归一化，避免提前中断时所有分数被 samples 固定分母压低。
  var used = 0;
  for (var k = 0; k < opponents.length; k++) {
    var opp = opponents[k];
    var maxSingle = opp.reduce(function (m, c) { return Math.max(m, engine.RANKS.indexOf(c.rank)); }, 0);
    var oppPressure = opp.length + maxSingle * 0.05;
    for (var j = 0; j < scored.length; j++) {
      var play = scored[j].play;
      var ownAfter = view.hand.length - play.cards.length;
      var usedBig = play.cards.filter(function (c) { return c.rank === '2' || engine.isBomb(play.detected); }).length;
      var expectedLeft = ownAfter + (usedBig ? 2 : 0);
      // [FIX 2026-11-19] key 夹到普通牌量级，避免天炸（99/100）把估价拉爆。
      var cardKey = Math.min(play.detected.key, 15);
      var price = cardKey * (pressing ? 0.2 : -0.07) + play.cards.length * (pressing ? 0.45 : 0.1);
      scored[j].score += oppPressure - expectedLeft + price;
    }
    used++;
    if (Date.now() - start > 60) break;
  }
  if (used > 0) scored.forEach(function (entry) { entry.score /= used; });
  scored.sort(function (a, b) { return b.score - a.score; });
  if (shouldHoldBomb(view, scored[0].play)) return { action: 'PASS' };
  return { action: 'PLAY', cardIds: scored[0].play.cards.map(function (c) { return c.id; }) };
}

function chooseAction(view, level) {
  assertView(view);
  if (level === 'EASY') return chooseEasy(view);
  if (level === 'HARD') return chooseHard(view);
  return chooseNormal(view);
}

module.exports = {
  assertView: assertView,
  chooseAction: chooseAction,
  FORBIDDEN_VIEW_KEYS: FORBIDDEN_VIEW_KEYS
};

  });
  __define('game-controller', function(module, exports, require){
'use strict';

var engine = require('./rule-engine.js');
var ai = require('./ai.js');

function createGame(options) {
  var opt = options || {};
  var playerCount = opt.playerCount || 3;
  var config = engine.defaultRuleConfig(playerCount);
  if (opt.config) config = opt.config;
  // [DESIGN 2026-11-18] 规则档：简化档关闭 4 条强制出牌规则，降低新手第一局的挫败感。
  // 引擎本来就按 forceRules 的布尔开关判定，这里只需给出另一套开关，不新增分支逻辑。
  if (opt.ruleMode === 'SIMPLE') {
    config.ruleMode = 'SIMPLE';
    config.ruleSetId = 'sbm-lmz-simple';
    config.forceRules = {
      seeKPlayA: false, seePairKPlayPairA: false,
      seeAPlay2: false, see2PlayBomb: false,
      unusedBombVoid: true, tripleABombCanPass: true
    };
  } else {
    config.ruleMode = 'CLASSIC';
  }
  var seed = typeof opt.seed === 'number' ? opt.seed : (Date.now() >>> 0);
  var deck = engine.shuffle(engine.createDeck(config), seed);
  var hands = engine.deal(deck, playerCount);
  // [DESIGN 2026-11-19] 可指定先出座位：轮次内从第 2 局起由上一局末位先出。
  // 说明清楚一件事：每局红桃 3 都是独立随机，先手优势（实测先手者胜率 40.5%）不会累积到同一个人，
  // 所以这不是"消除优势"，而是给落后方一次起手补偿，让一轮之内有翻盘窗口。
  // 指定了先出座位就必然不是红桃 3 持有者，因此首手"必须含红桃3"的约束自动失效。
  var explicitFirst = typeof opt.firstSeat === 'number' &&
    opt.firstSeat >= 0 && opt.firstSeat < playerCount;
  var firstSeat = 0;
  if (explicitFirst) firstSeat = opt.firstSeat;
  else {
    for (var i = 0; i < hands.length; i++) {
      if (hands[i].some(function (c) { return c.id === 'H3'; })) { firstSeat = i; break; }
    }
  }
  var difficulties = opt.difficulties || ['NORMAL', 'NORMAL', 'NORMAL', 'NORMAL'];
  var players = hands.map(function (hand, seat) {
    return {
      seat: seat,
      name: (opt.names && opt.names[seat]) || ('玩家' + (seat + 1)),
      isAI: seat !== 0,
      difficulty: seat === 0 ? 'HUMAN' : difficulties[seat],
      hand: hand,
      score: 0
    };
  });
  return {
    id: 'g_' + seed,
    roundId: 'r_' + seed,
    seed: seed,
    config: config,
    players: players,
    currentSeat: firstSeat,
    lastPlay: null,
    lastPlayerSeat: firstSeat,
    playedCards: [],
    passCount: 0,
    declared: {},
    bombVoid: {},
    playLog: [],
    status: 'PLAYING',
    winnerSeat: null,
    settlement: null,
    firstHandDone: explicitFirst
  };
}

function forceFlagsOf(game) {
  return engine.computeForceFlags(game.lastPlay, game.config);
}

// [FIX 2026-11-19] 规则标记只是"这种牌面触发了哪条规矩"，真正约束某个座位的是
// "他手上有没有对应的牌"。所有判定（可出、可过、提示、UI 提示条）统一走这个函数，
// 避免出现"过得了但炸不了"这类自相矛盾的行为。
function activeFlagsOf(game, seat) {
  var player = game.players[seat];
  if (!player) return [];
  return engine.activeForceFlags(forceFlagsOf(game), player.hand, game.config);
}

function getView(game, seat) {
  var player = game.players[seat];
  var flags = activeFlagsOf(game, seat);
  var legal = engine.getLegalPlays(player.hand, game.lastPlay, game.config, flags);
  if (!game.firstHandDone) {
    legal = legal.filter(function (p) {
      return p.cards.some(function (c) { return c.id === 'H3'; });
    });
  }
  return {
    seat: seat,
    hand: player.hand.slice(),
    legalPlays: legal,
    canPass: engine.canPass(game.lastPlay, flags, player.hand, game.config),
    public: {
      status: game.status,
      currentSeat: game.currentSeat,
      lastPlay: game.lastPlay ? {
        seat: game.lastPlay.seat,
        cards: game.lastPlay.cards.slice(),
        detected: game.lastPlay.detected
      } : null,
      playedCards: game.playedCards.slice(),
      declaredCounts: Object.assign({}, game.declared),
      handCounts: game.players.map(function (p) { return p.hand.length; }),
      forceFlags: flags.slice(),
      bombVoid: Object.assign({}, game.bombVoid)
    },
    config: game.config
  };
}

function removeCards(hand, ids) {
  var idSet = {};
  ids.forEach(function (id) { idSet[id] = true; });
  var removed = [];
  var kept = [];
  hand.forEach(function (c) {
    if (idSet[c.id] && removed.length < ids.length) removed.push(c);
    else kept.push(c);
  });
  hand.length = 0;
  kept.forEach(function (c) { hand.push(c); });
  return removed;
}

function advanceTurn(game) {
  game.currentSeat = (game.currentSeat + 1) % game.players.length;
}

function finishRound(game, winnerSeat) {
  game.status = 'FINISHED';
  game.winnerSeat = winnerSeat;
  game.settlement = engine.settleRound({
    config: game.config,
    players: game.players,
    winnerSeat: winnerSeat,
    playLog: game.playLog,
    roundId: game.roundId,
    settlementVersion: 1
  });
  return game.settlement;
}

function play(game, seat, cardIds) {
  if (game.status !== 'PLAYING') return { ok: false, error: 'GAME_NOT_PLAYING' };
  if (game.currentSeat !== seat) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (!cardIds || !cardIds.length) return { ok: false, error: 'EMPTY_PLAY' };
  var player = game.players[seat];
  var selected = cardIds.map(function (id) {
    return player.hand.filter(function (c) { return c.id === id; })[0];
  });
  if (selected.some(function (c) { return !c; })) return { ok: false, error: 'CARD_NOT_IN_HAND' };
  if (!game.firstHandDone && selected.some(function (c) { return c.id !== 'H3'; })) {
    if (!selected.some(function (c) { return c.id === 'H3'; })) return { ok: false, error: 'FIRST_MUST_CONTAIN_H3' };
  }
  var detected = engine.detectType(selected, game.config);
  if (!detected) return { ok: false, error: 'INVALID_CARD_TYPE' };
  var flags = activeFlagsOf(game, seat);
  // [FIX 2026-11-18] 直接校验，取代"枚举候选再按 id 精确匹配"。
  // 旧实现只认 generateCandidates 钦定的那一张带牌，玩家换合法带牌即被误判非法。
  if (!engine.beats(detected, game.lastPlay)) return { ok: false, error: 'ILLEGAL_PLAY' };
  if (!engine.satisfiesForce(detected, selected, flags)) return { ok: false, error: 'FORCED_TO_PLAY' };

  removeCards(player.hand, cardIds);
  game.lastPlay = { seat: seat, cards: selected.slice(), detected: detected };
  game.lastPlayerSeat = seat;
  game.passCount = 0;
  game.playedCards = game.playedCards.concat(selected);
  game.playLog.push({
    seq: game.playLog.length + 1, seat: seat, action: 'PLAY',
    cards: selected.slice(), detected: detected, firstHand: !game.firstHandDone,
    ts: Date.now()
  });
  game.firstHandDone = true;
  // [RELEASE 2026-11-18] 报牌只在还剩 1~threshold 张时成立；不改掉 0（已出完）会被误标"报牌 0"。
  if (game.config.declareCards.enabled && player.hand.length > 0 && player.hand.length <= game.config.declareCards.threshold) {
    game.declared[seat] = player.hand.length;
  }
  if (player.hand.length === 0) {
    var settlement = finishRound(game, seat);
    return { ok: true, finished: true, settlement: settlement, detected: detected };
  }
  advanceTurn(game);
  return { ok: true, finished: false, detected: detected };
}

function pass(game, seat) {
  if (game.status !== 'PLAYING') return { ok: false, error: 'GAME_NOT_PLAYING' };
  if (game.currentSeat !== seat) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (!game.lastPlay) return { ok: false, error: 'CANNOT_PASS_WHEN_LEADING' };
  var flags = activeFlagsOf(game, seat);
  if (!engine.canPass(game.lastPlay, flags, game.players[seat].hand, game.config)) return { ok: false, error: 'FORCED_TO_PLAY' };
  // [FIX 2026-11-19] 原有"留炸"计数（bombVoid）是死代码：只要手上真有炸弹，canPass 就会返回
  // false 提前返回，这段永远执行不到；而且倍率制下没打出去的炸弹本来就不翻倍，
  // "未用炸弹作废"已经由计分规则天然满足，不需要额外记账。这里删掉误导性的分支。
  game.passCount += 1;
  game.playLog.push({
    seq: game.playLog.length + 1, seat: seat, action: 'PASS', cards: [], ts: Date.now()
  });
  if (game.passCount >= game.players.length - 1) {
    game.lastPlay = null;
    game.passCount = 0;
    game.currentSeat = game.lastPlayerSeat;
  } else {
    advanceTurn(game);
  }
  return { ok: true, finished: false };
}

function aiTakeTurn(game) {
  if (game.status !== 'PLAYING') return { ok: false, error: 'GAME_NOT_PLAYING' };
  var seat = game.currentSeat;
  var player = game.players[seat];
  if (!player.isAI) return { ok: false, error: 'NOT_AI_SEAT' };
  var view = getView(game, seat);
  var decision = ai.chooseAction(view, player.difficulty);
  if (decision.action === 'PASS') {
    var passResult = pass(game, seat);
    return { ok: passResult.ok, action: 'PASS', seat: seat, error: passResult.error };
  }
  var result = play(game, seat, decision.cardIds);
  return {
    ok: result.ok, action: 'PLAY', seat: seat,
    cards: decision.cardIds, detected: result.detected,
    finished: result.finished, settlement: result.settlement, error: result.error
  };
}

module.exports = {
  createGame: createGame,
  getView: getView,
  play: play,
  pass: pass,
  aiTakeTurn: aiTakeTurn,
  forceFlagsOf: forceFlagsOf
};

  });
  __define('store', function(module, exports, require){
'use strict';

var memory = {};
var hasWx = typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function';

function read(key, fallback) {
  try {
    var value = hasWx ? wx.getStorageSync(key) : memory[key];
    return value === '' || value === undefined || value === null ? fallback : value;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (hasWx) wx.setStorageSync(key, value);
    else memory[key] = value;
    return true;
  } catch (e) {
    return false;
  }
}

// [FIX 2026-11-19] 音效与振动默认打开。此前四项全 false，而 audio.prompt() 整个受
// dialect 控制——新玩家第一局一声不响、不振动，只会怀疑"是不是卡了"。
// 牌类游戏的核心手感就是出牌那一声和炸弹的震感，不能要求玩家先去设置页找开关。
// BGM 仍默认关闭：进页面自动放音乐是打扰，也让首次进入的审核体验变差。
var DEFAULT_SETTINGS = { bgm: false, dialect: true, largeFont: true, vibration: true, ruleMode: 'CLASSIC' };

function getSettings() {
  var saved = read('sbm_settings', {});
  return Object.assign({}, DEFAULT_SETTINGS, saved);
}

function saveSettings(settings) {
  return write('sbm_settings', settings);
}

function getRecords() {
  return read('sbm_records', []);
}

function addRecord(record) {
  var records = getRecords();
  records.unshift(record);
  if (records.length > 200) records = records.slice(0, 200);
  write('sbm_records', records);
  return records;
}

function getStats() {
  return read('sbm_stats', { games: 0, wins: 0, escapes: 0, totalScore: 0 });
}

// [RELEASE 2026-11-18] 增加 escaped 参数：规则承诺"逃跑只记次数不计分"，此前无任何写入路径。
// 与 updateStats(false, 0, true) 配合统计主动退出；逃跑不改胜负、不加积分。
function updateStats(winner, delta, escaped) {
  var stats = getStats();
  stats.games += 1;
  if (winner) stats.wins += 1;
  if (escaped) stats.escapes = (stats.escapes || 0) + 1;
  stats.totalScore += delta || 0;
  write('sbm_stats', stats);
  return stats;
}

function getLocalLeaderboard() {
  var records = getRecords();
  var map = {};
  records.forEach(function (r) {
    // [FIX 2026-11-19] 热座记录没有"我"这个主体，进榜只会拉进"玩家1/2/3"这类脏名字，
    // 而且每人一条会把榜单刷满。热座单列，不计入个人榜。
    if (r.mode === 'HOTSEAT') return;
    if (!map[r.name]) map[r.name] = { name: r.name, score: 0, games: 0 };
    map[r.name].score += r.delta;
    map[r.name].games += 1;
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.score - a.score; });
}

// [RELEASE 2026-11-18] 清空战绩不应连带清掉用户设置。新增 clearRecords，clearAll 保留用于彻底重置。
function clearRecords() {
  ['sbm_records', 'sbm_stats'].forEach(function (key) {
    if (hasWx) { try { wx.removeStorageSync(key); } catch (e) {} }
    else delete memory[key];
  });
}

function clearAll() {
  ['sbm_settings', 'sbm_records', 'sbm_stats'].forEach(function (key) {
    if (hasWx) { try { wx.removeStorageSync(key); } catch (e) {} }
    else delete memory[key];
  });
}

module.exports = {
  getSettings: getSettings, saveSettings: saveSettings,
  getRecords: getRecords, addRecord: addRecord,
  getStats: getStats, updateStats: updateStats,
  getLocalLeaderboard: getLocalLeaderboard, clearRecords: clearRecords, clearAll: clearAll
};

  });
  global.SBM = {
    engine: __modules['rule-engine'],
    ai: __modules['ai'],
    controller: __modules['game-controller'],
    store: __modules['store']
  };
})(typeof window !== 'undefined' ? window :
   (typeof globalThis !== 'undefined' ? globalThis :
    (typeof GameGlobal !== 'undefined' ? GameGlobal : this)));
// [MINI-PROGRAM] 小程序端通过 require('./bundle.js') 加载：此时无 window，模块挂到全局对象。
// 追加 CommonJS 导出，使 `var SBM = require('./bundle.js')` 可直接拿到；浏览器 <script> 下 module 不存在，不执行。
if (typeof module !== 'undefined' && module.exports) {
  var __sbm = (typeof globalThis !== 'undefined' ? globalThis :
               (typeof GameGlobal !== 'undefined' ? GameGlobal : this));
  if (__sbm && __sbm.SBM) module.exports = __sbm.SBM;
}
