# 陕北捉老麻

一款 2～4 人的地方性扑克牌游戏。本仓库是**微信小程序工程**，同时归档了一份可在浏览器直接运行的 **H5 试玩版**，两者共用同一套规则引擎与 AI。

## 目录结构

```
game/
├── app.js / app.json / app.wxss / sitemap.json   # 小程序入口与全局配置
├── pages/                       # 小程序页面（每页 js / wxml / wxss / json）
│   ├── index/                   # 首页：模式、人数、难度、续局入口
│   ├── game/                    # 牌桌：选牌、出牌、提示、AI 调度、热座交接
│   ├── result/                  # 结算
│   ├── rules/                   # 玩法规则
│   ├── stats/                   # 本机战绩与排行榜
│   └── settings/                # 音效、振动、大字模式
├── utils/
│   ├── audio.js                 # InnerAudioContext 音频管理
│   └── fx.js                    # Canvas 2D 背景与庆祝特效
├── assets/audio/                # 程序合成的 WAV 音效与 BGM（无版权素材）
├── bundle.js                    # 核心逻辑唯一真相源：规则引擎 / AI / 控制器 / 存储
├── h5/                          # H5 试玩版（index.html + app.js + fx.js + styles.css）
├── tools/                       # 测试与资源生成脚本
└── project.config.json          # 微信开发者工具项目配置
```

`bundle.js` 是纯逻辑模块，同时兼容浏览器 `<script>` 和小程序 `require`；小程序入口直接 `require('./bundle.js')`，不存在副本或同步步骤。

## 快速开始

### 微信小程序

1. 打开 `project.config.json`，把 `appid` 从占位的 `touristappid` 换成你的真实小程序 AppID。
2. 用微信开发者工具**导入本目录（game/ 根目录，不是子目录）**，编译即可预览。
3. 真机预览需在开发者工具中点击"预览"扫码。

`miniprogramRoot` 为 `./`，`packOptions.ignore` 已排除 `h5/` 与 `tools/`，它们不会被打进小程序包。

### H5 试玩版

直接用浏览器打开 `h5/index.html` 即可（无需构建、无外部依赖）。它引用上一级的 `bundle.js`，用于规则与交互的快速验收。

## 玩法规则

- **牌堆**：3 人局 48 张（去掉大小王、3 张 2、1 张 A），每人 16 张；2 人局 48 张，每人 24 张；4 人局 52 张（仅去大小王），每人 13 张。
- **首出**：持红桃 3 者先出，首手必须包含红桃 3；出牌方向为逆时针。
- **牌型**：单张、对子、三张、三带一、三带二、顺子（5 张起，最大到 K）、连对（3 组起）、飞机（2 组起）、四张炸弹、天炸（AAA；4 人局 AAAA 也识别为天炸）。
- **强制规则**：见单 K 必出 A · 见对 K 必出对 A · 见 A 必出 2 · 见 2 必出炸弹。手上确实无对应牌时可不出。
- **计分（娱乐积分）**：胜者得其他玩家剩余张数之和 ×1；四张炸弹额外 +2，天炸额外 +5（非首手天炸按炸弹 +2）；其余玩家各扣对应分。逃跑只记次数不计分。
- 剩余 3 张以内自动报牌；已落地的牌不可收回。

规则全部由 `bundle.js` 中的 `defaultRuleConfig(playerCount)` 描述，牌型识别 `detectType(cards, config)` 会读取配置，`allowA` / `allow2` / `maxRank` / 各牌型 `enabled` / `minGroups` / `bomb.tripleA` 等均真实生效。游戏内"规则"页列有若干待本地玩家确认的默认项，确认后改配置即可，无需改代码。

## 功能特性

- **人机 / 热座**两种模式；AI 提供简单、普通、困难三档，困难档基于对手手牌采样评估、不作弊。
- **断点续局**：对局快照存入本机 storage，重进自动恢复；热座模式续局时强制显示交接遮罩，防止偷看手牌。
- **生命周期处理**：`onHide` 暂停 AI 定时器、音频与特效并保存快照，`onShow` 恢复。
- **分享**：各页面均实现 `onShareAppMessage`。
- **设置**：背景音乐、提示音、振动反馈、大字模式（牌桌卡牌同步放大）。
- **本机战绩**：对局记录与排行榜，热座下按玩家名分别记录。

## 开发与测试

需要 Node.js（仅脚本使用，小程序本身无需构建）。

| 命令 | 作用 |
| --- | --- |
| `node tools/test-bundle.js` | 核心逻辑回归（37 项）：牌型、带牌、强制规则、配置、计分、AI、牌力，含 2/3/4 人 × 3 难度各 20 局整局模拟 |
| `node tools/verify-miniprogram.js` | 工程校验（63 项）：页面四件套、JSON 合法性、WXML 标签配对、资源齐全、能力接入、H5 归档 |
| `node tools/gen-audio.js` | 重新生成 `assets/audio/` 下的 4 个 WAV 文件 |

改动 `bundle.js` 后无需任何同步操作，直接刷新小程序即可生效。建议提交前跑一遍上面两个校验脚本。

## 实现说明

- **核心与视图分离**：`bundle.js` 是无平台依赖的纯数据逻辑（内部包含规则引擎、AI、控制器、存储），视图层完全用 `setData` 驱动，不使用 DOM 或 `innerHTML`。
- **存储**：store 模块自动检测 `wx.getStorageSync`，小程序的走 wx 存储，浏览器回退到 `localStorage`。
- **音频**：小程序没有 WebAudio 程序合成 API，因此用 `tools/gen-audio.js` 以纯代码生成 WAV 文件，再由 `InnerAudioContext` 播放。
- **特效**：`utils/fx.js` 使用小程序 Canvas 2D（`SelectorQuery` 取节点 + `canvas.requestAnimationFrame`），实现星空、山峦、孔明灯、窑洞暖光与庆祝烟花。
- **代码标记**：规则引擎中的历史修复带 `[FIX 2026-11-18]` 注释，小程序适配带 `[MINI-PROGRAM]` 注释，便于追踪来源。

## 已知事项

1. `project.config.json` 的 `appid` 需替换为真实 AppID（当前为游客占位）。
2. `tools/build-bundle.js` 原用于从 `../shengbei-laomazi/utils` 拼接出 `bundle.js`，该源目录当前不在仓库内。目前 `bundle.js` 是唯一真相源并已纳入版本管理；构建脚本在源目录缺失时会明确报错，并阻止缺少历史修复标记的旧产物覆盖当前文件（确认要覆盖可加 `--force`）。
3. 好友房、云端战绩、账号体系尚未实现，需要后端/云函数支持。积分仅作本机娱乐记录。
4. 游戏内规则页列出了 12 项"待本地玩家确认"的默认规则取舍，需由玩家确认后再固化。
