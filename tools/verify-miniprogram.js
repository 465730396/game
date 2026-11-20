'use strict';

// 校验小程序工程结构完整性。运行：node tools/verify-miniprogram.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let pass = 0, fail = 0, todo = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}
// 只能人工处理的项目（拿 AppID、备案、版号），不算代码失败，但要显式留在清单上
function pending(cond, name) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { todo++; console.log('  TODO  ' + name + '   ← 需人工处理'); }
}
function exists(p) { return fs.existsSync(path.join(root, p)); }
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); }
  catch (e) { return null; }
}

console.log('\n=== 1. 工程骨架 ===');
['app.js', 'app.json', 'app.wxss', 'sitemap.json'].forEach(function (f) {
  ok(exists(f), f + ' 存在');
});
ok(exists('project.config.json'), 'project.config.json 存在');
const projectCfg = readJSON('project.config.json');
ok(projectCfg && projectCfg.miniprogramRoot === './', 'miniprogramRoot 指向仓库根');

console.log('\n=== 2. app.json 页面注册 ===');
const appCfg = readJSON('app.json');
ok(!!appCfg, 'app.json 合法');
const pages = appCfg && appCfg.pages || [];
ok(pages.length === 7, '注册 7 个页面，实际 ' + pages.length);

console.log('\n=== 3. 每页四件套 ===');
pages.forEach(function (p) {
  ['.js', '.wxml', '.wxss', '.json'].forEach(function (ext) {
    ok(exists(p + ext), p + ext);
  });
});

console.log('\n=== 4. 页面 JSON 合法 ===');
pages.forEach(function (p) {
  ok(!!readJSON(p + '.json'), p + '.json 合法');
});

console.log('\n=== 5. WXML 标签配对（粗检）===');
pages.forEach(function (p) {
  const xml = fs.readFileSync(path.join(root, p + '.wxml'), 'utf8');
  // 排除自闭合标签（<switch ... />），只统计需要成对出现的容器标签
  const opens = (xml.match(/<(view|button|scroll-view|canvas)\b[^>]*?(?<!\/)>/g) || []).length;
  const closes = (xml.match(/<\/(view|button|scroll-view|canvas)>/g) || []).length;
  ok(opens === closes, p + '.wxml 主要标签配对 (' + opens + '/' + closes + ')');
});

console.log('\n=== 6. 核心逻辑与音频资源 ===');
ok(exists('bundle.js'), 'bundle.js 存在（唯一真相源，无副本）');
ok(!exists('core'), '不存在多余的 core/ 副本目录');
ok(!exists('miniprogram'), '不存在多余的 miniprogram/ 嵌套目录');
['play.mp3', 'turn.mp3', 'bomb.mp3', 'bgm.mp3'].forEach(function (f) {
  ok(exists('assets/audio/' + f), '音频 ' + f);
});
ok(!exists('assets/audio/bgm.wav'), '未压缩 WAV 已清理（只保留 mp3，省约 258KB）');
ok(exists('utils/audio.js'), '音频模块存在');
ok(!exists('utils/fx.js'), '背景特效已改为纯 CSS 层，canvas 实现已移除');
ok(exists('utils/privacy.js'), '隐私/相册授权模块存在');

console.log('\n=== 7. 关键能力接入检查 ===');
const gameJs = fs.readFileSync(path.join(root, 'pages/game/game.js'), 'utf8');
ok(/saveSnapshot/.test(gameJs) && /getSession/.test(gameJs), '断点续局已接入');
ok(/onShareAppMessage/.test(gameJs), '分享已接入');
ok(/onHide/.test(gameJs) && /onShow/.test(gameJs), '生命周期暂停/恢复已接入');
const allPagesHaveShare = pages.every(function (p) {
  return /onShareAppMessage/.test(fs.readFileSync(path.join(root, p + '.js'), 'utf8'));
});
ok(allPagesHaveShare, '所有页面均支持分享');

console.log('\n=== 8. H5 归档与入口引用 ===');
['index.html', 'app.js', 'fx.js', 'styles.css'].forEach(function (f) {
  ok(exists('h5/' + f), 'H5 ' + f + ' 已归档到 h5/');
});
const h5Html = fs.readFileSync(path.join(root, 'h5/index.html'), 'utf8');
ok(/src="\.\.\/bundle\.js"/.test(h5Html), 'H5 的 bundle.js 路径指向仓库根');
const entryJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
ok(/require\('\.\/bundle\.js'\)/.test(entryJs), '小程序入口直接 require 根 bundle.js');
ok(!/core\/bundle\.js|sync-core/.test(entryJs), '入口无残留 core/ 副本引用');

console.log('\n=== 9. 上线能力检查 ===');
const gameSrc = fs.readFileSync(path.join(root, 'pages/game/game.js'), 'utf8');
ok(/onExit/.test(gameSrc), '牌桌有退出入口');
ok(/recordEscape/.test(gameSrc), '退出记为逃跑');
ok(/autoSelectFirstHand/.test(gameSrc), '首手自动选中红桃3');
ok(/if \(this\.finished\) return;/.test(gameSrc), '结算防重复写入');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
ok(/recordEscape/.test(appSrc), 'app 暴露 recordEscape');
const bundleSrc = fs.readFileSync(path.join(root, 'bundle.js'), 'utf8');
ok(/function clearRecords/.test(bundleSrc) && /clearRecords: clearRecords/.test(bundleSrc), 'store 提供 clearRecords');
ok(/if \(escaped\)/.test(bundleSrc), 'updateStats 支持逃跑计数');
const resultSrc = fs.readFileSync(path.join(root, 'pages/result/result.js'), 'utf8');
ok(/reLaunch/.test(resultSrc), '结算返回首页用 reLaunch');
ok(/badgeText/.test(resultSrc), '结算角标区分胜负/赢家');
ok(/r\.level/.test(resultSrc) && /r\.mode/.test(resultSrc), '再来一局沿用原参数');
const statsSrc = fs.readFileSync(path.join(root, 'pages/stats/stats.js'), 'utf8');
ok(/clearRecords/.test(statsSrc) && !/clearAll\(\)/.test(statsSrc), '清空战绩不影响设置');
pages.forEach(function (p) {
  const wxml = fs.readFileSync(path.join(root, p + '.wxml'), 'utf8');
  ok(/large-font/.test(wxml), p + ' 支持大字模式');
});

console.log('\n=== 10. 设计增强（倍率 / 轮次 / 规则档 / 手感 / 分享） ===');
const gameWxml = fs.readFileSync(path.join(root, 'pages/game/game.wxml'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8');
const indexWxml = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8');
const resultWxml = fs.readFileSync(path.join(root, 'pages/result/result.wxml'), 'utf8');
ok(/bombMode: 'MULTIPLIER'/.test(bundleSrc), '计分改为炸弹倍率制');
ok(/multiplier: multiplier/.test(bundleSrc), '结算返回倍率');
ok(/totalDelta/.test(bundleSrc), '结算返回总变化（守恒校验用）');
ok(/opt\.ruleMode === 'SIMPLE'/.test(bundleSrc), 'createGame 支持简化规则档');
ok(/shouldHoldBomb/.test(bundleSrc), 'AI 有留炸判断');
ok(/leaderSeatOf/.test(bundleSrc), 'AI 能识别领跑者');
ok(/onRuleMode/.test(indexSrc) && /onRuleMode/.test(indexWxml), '首页可切换规则档');
ok(/roundText/.test(gameSrc) && /roundIndex/.test(gameSrc), '牌桌显示轮次进度');
ok(/buildCounter/.test(gameSrc) && /counter-chip/.test(gameWxml), '牌桌有记牌器');
ok(/passReason/.test(gameSrc) && /pass-reason/.test(gameWxml), '不出被禁用时说明原因');
ok(/seat-last/.test(gameWxml), '座位标记上一手');
ok(/flashPlay/.test(gameSrc) && /shake/.test(gameWxml), '出牌动效与炸弹震屏');
ok(/AI_LINES/.test(gameSrc), 'AI 有台词');
ok(/paintPoster/.test(resultSrc) && /privacy\.saveImage/.test(resultSrc), '结算页可生成并保存战绩图');
ok(/id="poster"/.test(resultWxml), '战绩图 canvas 已挂载');
ok(/roundDone/.test(resultSrc) && /totals/.test(resultWxml), '结算页展示本轮累计');

console.log('\n=== 11. 发布就绪（AppID / 隐私 / 更新 / 体积 / 排错） ===');
ok(typeof projectCfg.appid === 'string' && projectCfg.appid.length > 0, 'project.config.json 有 appid 字段');
pending(projectCfg.appid !== 'touristappid', 'appid 已换成真实 AppID（当前 ' + projectCfg.appid + '）');
const setting = projectCfg.setting || {};
ok(setting.urlCheck === true, 'urlCheck 已开启');
ok(setting.es6 === true, 'ES6 转 ES5 已开启');
ok(setting.enhance === true, '增强编译已开启');
ok(setting.minified === true && setting.minifyWXSS === true && setting.minifyWXML === true, '上传压缩已开启');
const ig = (projectCfg.packOptions && projectCfg.packOptions.ignore) || [];
const igVal = function (t) { return ig.some(function (x) { return x.type === t; }); };
ok(igVal('folder') && ig.some(function (x) { return x.value === 'h5'; }), 'h5/ 已排除出包');
ok(ig.some(function (x) { return x.value === 'tools'; }), 'tools/ 已排除出包');
ok(ig.some(function (x) { return x.value === 'README.md'; }), 'README.md 已排除出包');
ok(appCfg.lazyCodeLoading === 'requiredComponents', 'lazyCodeLoading 已开启（启动优化）');
ok(/getUpdateManager/.test(appSrc), '已接入版本更新提示');
ok(/onError/.test(appSrc) && /onUnhandledRejection/.test(appSrc), '已捕获全局异常');
ok(/getErrorLog/.test(appSrc), '异常记录可读取（设置页可复制）');
const privacySrc = fs.readFileSync(path.join(root, 'utils/privacy.js'), 'utf8');
ok(/getPrivacySetting/.test(privacySrc), '隐私授权状态查询已接入');
ok(/requirePrivacyAuthorize/.test(privacySrc), '隐私授权弹窗已接入');
ok(resultSrc.indexOf('ensurePrivacy') >= 0 && resultSrc.indexOf('ensurePrivacy') < resultSrc.indexOf('ensurePoster', resultSrc.indexOf('onSavePoster')), '保存流程先要隐私授权再画 canvas（手势上下文不丢失）');
const audioSrc = fs.readFileSync(path.join(root, 'utils/audio.js'), 'utf8');
ok(/\.mp3'/.test(audioSrc) && !/\.wav'/.test(audioSrc), '音频引用 mp3（已压缩）');
const skipDirs = ['.git', 'h5', 'tools', 'node_modules', '.workbuddy'];
function walkSize(p) {
  const name = path.basename(p);
  if (skipDirs.indexOf(name) >= 0 || name === 'README.md' || name === '.DS_Store') return 0;
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce(function (s, n) { return s + walkSize(path.join(p, n)); }, 0);
}
const packKB = walkSize(root) / 1024;
ok(packKB < 2048, '预估打包体积 < 2MB（实际 ' + packKB.toFixed(0) + ' KB）');

console.log('\n=== 12. 游戏性优化（牌堆 / 先手 / 教学 / 每日挑战 / 逐局） ===');
ok(/removeRanks: \{ '2': 3, 'A': 1 \}, totalCards: 48/.test(bundleSrc), '牌堆为 48 张标准堆（1 张 2、3 张 A）');
const rulesWxmlSrc = fs.readFileSync(path.join(root, 'pages/rules/rules.wxml'), 'utf8');
ok(/48 张/.test(rulesWxmlSrc) && /只有 1 张 2/.test(rulesWxmlSrc), '规则页写明 48 张、全场只有 1 张 2');
ok(/48 张/.test(indexWxml) && /1 张 2/.test(indexWxml), '首页标注 48 张、唯一 1 张 2');
ok(!/51 张|52 张全牌/.test(indexWxml + rulesWxmlSrc + bundleSrc.replace(/\/\/[^\n]*/g, '')),
  '不再出现 51/52 张的旧牌堆（含注释外的代码与页面文案）');
ok(/typeof opt\.firstSeat === 'number'/.test(bundleSrc), '引擎支持指定先出座位');
ok(/firstHandDone: explicitFirst/.test(bundleSrc), '指定先手时跳过"首手含红桃3"约束');
ok(/nextFirstSeat/.test(gameSrc), '轮次内由上一局末位先出');
ok(/roundHistory/.test(gameSrc), '逐局得分记录在牌桌侧维护');
ok(/history: history/.test(gameSrc), '轮次状态携带逐局得分');
ok(/FORCE_DETAIL/.test(gameSrc) && /explainForce/.test(gameSrc), '强制规则首次拦截时弹窗解释');
ok(/sbm_forcetip/.test(gameSrc), '强制规则教学只提示一次（本地去重）');
ok(/daily === '1'/.test(gameSrc) && /saveDaily/.test(gameSrc), '每日挑战：固定 seed 单局');
ok(/dailySeed/.test(gameSrc), '每日挑战用日期作为 seed');
ok(/onDaily/.test(indexSrc), '首页有每日挑战入口');
ok(/dailyDesc/.test(indexWxml), '首页展示今日挑战成绩');
ok(/history/.test(resultSrc) && /hist-grid/.test(resultWxml), '结算页展示逐局得分');
ok(/roundSize > 1/.test(resultWxml), '单局模式不显示轮次面板');
ok(/末位先出/.test(fs.readFileSync(path.join(root, 'pages/rules/rules.wxml'), 'utf8')), '规则页说明末位先出');

console.log('\n=== 13. 运行时事故修复（快照 / 轮次 / 跳转 / 遮挡 / 静音） ===');
ok(/SESSION_VERSION/.test(appSrc) && /validSession/.test(appSrc), '续局快照带版本号并做结构校验');
ok(/setInnerAudioOption/.test(appSrc) && /obeyMuteSwitch:\s*false/.test(appSrc), 'iOS 静音键下仍可出声');
ok(/if \(!this\.daily\) \{/.test(gameSrc), '每日挑战不触碰轮次进度');
ok(/clearRedirect/.test(gameSrc) && /redirectTimer/.test(gameSrc), '结算跳转定时器可取消');
ok(/!self\.alive \|\| self\.redirected/.test(gameSrc), '跳转前校验页面存活与重复跳转');
ok(/hand: hidden \? \[\] : hand/.test(gameSrc), '热座交接期间不下发手牌');
ok((gameSrc.match(/if \(this\.data\.handoff\) return;/g) || []).length >= 4, '遮罩期间四个操作入口均有二次校验');
ok(/var DEFAULT_SETTINGS = \{ bgm: false, dialect: true/.test(bundleSrc), '音效默认开启（BGM 仍默认关闭）');
ok(/if \(r\.mode === 'HOTSEAT'\) return;/.test(bundleSrc), '热座记录不进个人排行榜');
ok(/if \(this\.hotseat\) \{[\s\S]{0,200}'热座对局'/.test(gameSrc), '热座一局只写一条记录');
ok(/prev\.date !== rec\.date/.test(gameSrc) && !/better/.test(gameSrc), '每日挑战成绩以首次为准');
ok(!/setTimeout\(function \(\) \{ self\.ensurePoster/.test(resultSrc), '结算页不再预画战绩图');
ok(/counts: \[3, 4\]/.test(indexSrc) && /2 人场暂时下线/.test(indexSrc), '2 人场已下线（引擎保留）');
const sitemap = readJSON('sitemap.json');
const smRules = (sitemap && sitemap.rules) || [];
ok(smRules.length && smRules[0].action === 'allow' && smRules[0].page === 'pages/index/index', 'sitemap 只放开首页');
ok(smRules.some(function (r) { return r.action === 'disallow' && r.page === '*'; }), 'sitemap 其余页面不索引');
ok(fs.existsSync(path.join(root, 'tools/test-pages.js')), '页面级回归脚本存在');

console.log('\n=== 14. 隐私指引页与特效性能 ===');
ok(pages.indexOf('pages/privacy/privacy') >= 0, '隐私指引页已在 app.json 注册');
const privacyWxml = fs.readFileSync(path.join(root, 'pages/privacy/privacy.wxml'), 'utf8');
const privacyPage = fs.readFileSync(path.join(root, 'pages/privacy/privacy.js'), 'utf8');
ok(/相册/.test(privacyPage) && /剪贴板/.test(privacyPage), '正文声明了相册与剪贴板用途');
ok(/仅写入/.test(privacyPage), '声明相册"仅写入、不读取"');
ok(/不会获取的信息/.test(privacyWxml) || /不会获取/.test(privacyPage), '正文列明不获取的信息');
ok(/清除本机数据/.test(privacyWxml) && /onClear/.test(privacyPage), '提供本机数据删除入口');
ok(/clearRecords/.test(privacyPage), '删除入口调用 store.clearRecords');
const settingsWxml2 = fs.readFileSync(path.join(root, 'pages/settings/settings.wxml'), 'utf8');
const settingsSrc = fs.readFileSync(path.join(root, 'pages/settings/settings.js'), 'utf8');
ok(/bindtap="onPrivacy"/.test(settingsWxml2) && /pages\/privacy\/privacy/.test(settingsSrc), '设置页有可点开的隐私指引入口');
ok(/openGuide/.test(privacySrc) && /openGuide/.test(resultSrc), '保存失败时引导到指引页（而非无用的 openSetting）');
// [FIX 2026-11-19] 背景特效从原生 canvas 换成纯 CSS 层。
// canvas 是原生组件，层级不受 z-index 完全控制，一旦盖住同层内容，页面就是"存在但看不见"。
// 这里改为断言"牌桌页不再有 canvas"，防止这段历史问题被重新引入。
const gameWxmlBg = fs.readFileSync(path.join(root, 'pages/game/game.wxml'), 'utf8');
const gameWxssBg = fs.readFileSync(path.join(root, 'pages/game/game.wxss'), 'utf8');
ok(!/<canvas/.test(gameWxmlBg), '牌桌页不再使用原生 canvas（消除层叠遮挡风险）');
ok(!/fx-canvas/.test(gameWxssBg) && !/require\('\.\.\/\.\.\/utils\/fx\.js'\)/.test(gameSrc),
  '牌桌页已完全脱离 canvas 特效模块');
ok(/class="sky"/.test(gameWxmlBg) && /\.sky \{[\s\S]{0,400}linear-gradient\(180deg, #160A1E/.test(gameWxssBg),
  '夜空由 CSS 渐变层绘制（顶部洋红雾 → 底部青辉）');
ok(/\.mote[\s\S]{0,300}moteFloat/.test(gameWxssBg), '光尘为 CSS 动画，不再有逐帧脚本');
ok(!/\.game-page \{[^}]*overflow: hidden/.test(gameWxssBg), '页面根不再 overflow:hidden（避免整页被裁成 0 高）');

console.log('\n=== 15. 视觉系统（赛博皮影 · NEON SHADOW） ===');
const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8');
const gameWxss = fs.readFileSync(path.join(root, 'pages/game/game.wxss'), 'utf8');
const indexWxss = fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8');
const resultWxss = fs.readFileSync(path.join(root, 'pages/result/result.wxss'), 'utf8');
const resultSrc2 = fs.readFileSync(path.join(root, 'pages/result/result.js'), 'utf8');

// 色板：近黑底 + 三支霓虹。断言具体色值，防止后续改动把整体调回低对比暖色。
ok(/--void:\s*#04060C/.test(appWxss) && /--cyan:\s*#2CF2FF/.test(appWxss) && /--magenta:\s*#FF2D7A/.test(appWxss),
  '全局色板为近黑底 + 激光青 / 电光洋红 / 酸性黄绿');
ok(/--gold:\s*#2CF2FF/.test(appWxss), '旧变量名 --gold 已指向霓虹青（次级页面不会退回暖色）');
// 首页冲击力：大标题 + 故障层 + 竖向水印
ok(/\.glitch\s*\{[^}]*font-size:\s*104rpx/.test(indexWxss), '首页主标题为 104rpx 超粗字');
ok(/\.glitch::before[\s\S]{0,200}attr\(data-text\)/.test(indexWxss) && /data-text="捉老麻"/.test(indexWxml),
  '标题带双色错位故障层');
ok(/\.hero::after[\s\S]{0,220}rgba\(255, 45, 122, 0\.22\)/.test(indexWxss), 'HERO 用洋红辉光做纵深（不用低透明度大字，避免糊成灰块）');
ok(/\.hero-scan[\s\S]{0,300}animation:\s*heroScan/.test(indexWxss), 'HERO 有缓慢下扫的扫描带');
ok(/\.hud-num\s*\{[^}]*font-size:\s*56rpx/.test(indexWxss), '胜率做成 HUD 大字读数');
// 面板 / 按钮 / 分段
ok(/\.panel::before[\s\S]{0,240}box-shadow:\s*0 0 14rpx/.test(appWxss) && /\.panel::after[\s\S]{0,160}border-right/.test(appWxss),
  '面板为黑玻璃 + 上沿扫描线 + 右下角刻度');
ok(/\.btn\s*\{[\s\S]{0,700}linear-gradient\(100deg, #D9FF45/.test(appWxss) && /animation:\s*btnSheen/.test(appWxss),
  '主按钮为酸性渐变 + 持续扫光');
ok(/\.btn-outline[\s\S]{0,260}rgba\(44, 242, 255, 0\.46\)/.test(appWxss), '次按钮为青色灯管描边');
ok(/\.pill\.on\s*\{[\s\S]{0,220}rgba\(255, 45, 122, 0\.55\)/.test(appWxss), '选中项为洋红发光胶囊');
ok(!/0 8rpx 0 #6E4A1E/.test(appWxss), '旧的鎏金厚底按钮样式已彻底移除');
// 牌面
ok(/\.card\s*\{[\s\S]{0,700}rgba\(44, 242, 255, 0\.32\)/.test(appWxss) && /\.card::after/.test(appWxss),
  '牌面为暗场全息卡（霓虹细边 + 斜向冷光）');
ok(/\.card\.red \.card-rank\s*\{[^}]*text-shadow/.test(appWxss) && /\.card\.black \.card-rank\s*\{[^}]*text-shadow/.test(appWxss),
  '点数自带红/青辉光');
// 牌桌
ok(/\.r1[\s\S]{0,320}animation:\s*ringSpin 9s linear infinite/.test(gameWxss) && /@keyframes ringSpin/.test(gameWxss),
  '牌桌有旋转的青色光环');
ok(/\.r2[\s\S]{0,420}reverse/.test(gameWxss) && /\.table-core[\s\S]{0,700}coreBreath/.test(gameWxss),
  '内环反向旋转 + 中心呼吸光');
ok(/\.hand-row/.test(gameWxss) && /\.hand-card\.selected[\s\S]{0,300}rgba\(255, 45, 122, 0\.85\)/.test(gameWxss),
  '手牌叠压，选中上浮并套洋红光环');
ok(/handPad: handPad/.test(gameSrc) && /handDense: dense/.test(gameSrc), '叠压步长按牌数实时计算');
ok(/var CW = dense \? 86 : 100/.test(gameSrc) && /\.hand-row\.dense \.card \{ width: 86rpx/.test(gameWxss),
  '叠压常量与 CSS 牌宽一致（防止末张挤出屏幕）');
ok(/margin-left:\{\{index===0\?0:handPad\}\}rpx/.test(gameWxml), '手牌逐张应用负边距');
ok(!/\.table::after/.test(gameWxss) && /table-empty/.test(gameWxml), '空场用居中提示，左上角只标轮次');
ok(/\.table-empty[\s\S]{0,260}emptyFlicker/.test(gameWxss), '空场提示带微弱闪烁');
// 结算
ok(/\.medal-ring[\s\S]{0,220}medalSpin/.test(resultWxss) && /\.result-badge\.win[\s\S]{0,300}#E6FF6A/.test(resultWxss),
  '结算奖章为双层旋转光环 + 酸性发光章');
ok(/\.score-delta\.up\s*\{[^}]*var\(--magenta\)/.test(resultWxss), '正分用洋红、负分用青绿（符合国内涨跌习惯）');
// 倍率留痕：一轮 5 局里哪一局炸过，必须在结算页能一眼看到
ok(/class="hist-mx"/.test(resultWxml) && /\.hist-cell\.bombed/.test(resultWxss), '逐局得分标出炸过的局与倍率');
ok(/roundPeakText/.test(resultWxml) && /\.total-tip\.peak/.test(resultWxss), '轮次结束显示本轮最高倍率');
ok(/multiplier:\s*s\.multiplier/.test(gameSrc), '逐局历史记录倍率（轮次汇总有据可依）');
// 背景特效
ok(/\.sky-glow\.g1[\s\S]{0,200}rgba\(44, 242, 255, 0\.16\)/.test(gameWxssBg), '夜空左上角带青色辉光');
ok(/\.sky-glow\.g2[\s\S]{0,200}rgba\(255, 45, 122, 0\.14\)/.test(gameWxssBg), '夜空右下角带洋红辉光');
ok(/#04060C/.test(appCfg.window.navigationBarBackgroundColor || ''), '导航栏底色与新主题一致');
// 战绩图
ok(/rgba\(255,45,122,0\.40\)/.test(resultSrc2) && /N E O N   S H A D O W/.test(resultSrc2), '战绩分享图同步为霓虹风格');
// 首页其余形态
ok(/\.daily-date/.test(indexWxss) && /\.daily-cta/.test(indexWxss), '每日挑战为日期块 + 动作条');
ok(/\.hotseat-row/.test(indexWxss) && /\.hotseat-pills/.test(indexWxss), '同屏热座人数与按钮同排');
ok(/\.resume-bar/.test(indexWxss) && /\.live-dot/.test(indexWxss), '续局条为洋红告警条 + 呼吸点');
ok(!/\.panel-title \{[^}]*border-left/.test(appWxss), '旧标题样式已移除');
// 实时倍率：2026-11-19 修复前，倍率只在结算页出现，牌桌打炸毫无反馈
ok(/mult-chip/.test(gameWxml) && /multiplier > 1/.test(gameWxml), '牌桌头部挂实时倍率徽标（×1 时不占版面）');
ok(/@keyframes multPop/.test(gameWxss) && /\.mult-flash/.test(gameWxss), '翻倍瞬间有弹出动画');
ok(/computeBombMultiplier/.test(gameSrc) && /multFlash/.test(gameSrc), '牌桌倍率走公共函数，翻倍才闪烁');
ok(/computeBombMultiplier:\s*computeBombMultiplier/.test(bundleSrc), '倍率计算函数已导出，牌桌与结算同口径');
// 炸弹高光：稀有事件必须有对应量级的反馈，但不能挡住操作
ok(/\.bomb-banner[\s\S]{0,220}position:\s*fixed/.test(gameWxss) && /\.bomb-banner[\s\S]{0,320}pointer-events:\s*none/.test(gameWxss),
  '炸弹横幅为纯展示层（fixed + pointer-events:none，不拦点击）');
ok(/wx:if="\{\{bombBanner\}\}"/.test(gameWxml) && /@keyframes bombIn/.test(gameWxss), '横幅存在且带入场动画');
ok(/clearBombTimer/.test(gameSrc) && /bombBannerText/.test(gameSrc), '横幅文案由倍率驱动，定时器可随页面卸载取消');

console.log('\n总计 PASS=' + pass + '  FAIL=' + fail + (todo ? '  TODO=' + todo : ''));
if (todo) console.log('TODO 项需在小程序后台/资质侧人工完成，不影响代码构建。');
process.exit(fail ? 1 : 0);
