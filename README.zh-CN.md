# ra2-arena

[English](README.md) · **简体中文**

一个让大语言模型互相对战《命令与征服：红色警戒 2》的竞技场：跨多张地图的循环赛季、Bradley-Terry / Elo
排名，并把整个过程做成直播内容。这是一个内容项目，不是托管服务。

## 现状

2026-09-09 启动。可行性研究已完成，框架已定。目前跑通两条线：

- **Mode A（无头引擎）。** 从我们自己的游戏文件初始化（273 张地图），把整局打到分出结果，包括模型对模型
  （见下文「让模型来打」）。
- **Mode B（真实 Windows 客户机）。** 一个容器化运行时在单台宿主上用 KVM 启动两台 Windows XP 客户机，
  用 IPX 局域网把它们连起来，并通过 HTTP 提供每台客户机的实时截图。见
  [experiments/xp-vm](experiments/xp-vm/)。它取代了早前的 Windows 98 浏览器尝试
  （[experiments/win98-browser](experiments/win98-browser/)，一个存档的死路）：那个模拟器构建没有可用的
  以太网后端，两个实例无法打局域网对战。

Chrono Divide 浏览器客户端这条路（[experiments/cd-multiplayer](experiments/cd-multiplayer/)）目前也是
死路（资产导入从不发起请求）；上面那条引擎线才是 Mode A 的底座。

请先读 [docs/research/2026-09-09-feasibility.md](docs/research/2026-09-09-feasibility.md)。

## 已定的决策

| # | 决策 | 含义 |
|---|---|---|
| 1 | **做内容，不做平台** | 我们直播对局、发布结果。不为第三方托管服务：不做账号、不做多租户、不托管资产。 |
| 2 | **两种对战模式，一起做** | Mode A：API 回合制（无头引擎，模型思考时游戏暂停）。Mode B：真实电脑操作（每个模型实时驱动一个真实浏览器客户端）。两者共用同一套赛事内核。 |
| 3 | **引擎：Chrono Divide + `@chronodivide/game-api`** | 理由见可行性研究。 |
| 4 | **Windows 98 路线 = Mode B 的候选后端** | 在单台 Linux 宿主上用一批 QEMU/KVM Windows 98 虚拟机跑原版 RA2 二进制；IPX 走多播虚拟局域网；QMP 负责暂停、截图和输入。在 M0 里限时验证，不行就放弃。 |
| 5 | **公开仓库，英文 + 简体中文** | 不能公开的东西一律不进来。游戏/系统资产永不提交；README 只为已经拥有游戏的人链接存档镜像（见 [游戏文件](#游戏文件)）。 |

硬性规则：

- 游戏资产（`*.mix`）、Windows 98 镜像和任何 Chrono Divide 客户端文件 **永不提交**。请自备正版《红色警戒 2》。
- 模型 API key 只放在 `.env`（已 gitignore）。

## 架构（规划中）

```
packages/
  core/            对局与赛季模型、模型适配器（Anthropic/OpenAI 兼容端点）、
                   决策日志（提示、回复、延迟、成本）、Bradley-Terry 与 Elo、回放统计
  driver-api/      Mode A：game-api 无头驱动。每 K tick：暂停 -> 序列化该玩家的
                   战争迷雾视角 -> 模型返回一批命令 -> 校验 -> 下达 -> 恢复
  driver-browser/  Mode B：Playwright，每个模型一个 Chrome。资产导入、登录、私人房间、
                   截图 -> 动作循环、终局检测
  broadcast/       Mode A「先算后播」（在真实客户端里回放，叠加按 tick 同步的模型推理字幕）；
                   Mode B 实时叠加层（OBS 浏览器源）
apps/
  runner/          调度：循环赛 x 地图 x 换边、预算、断点续跑、results.jsonl
data/              results.jsonl（纳入版本）；replays/ logs/ screens/（忽略）
docs/              研究、决策、赛事规则
```

### 每种模式怎么上直播

- **Mode A，先算后播。** 对局离线模拟，模型思考时游戏暂停。产出是一个 `.rpl` 回放加一份逐 tick 决策日志。
  直播时，回放在真实客户端里按正常速度播放，叠加双方模型的推理和经济/军队曲线。观众事先不知道结果；这是一场首映。
- **Mode B，实时。** 两个 Chrome 实例，各跑一个模型。观察者的全图视角是主画面；每个模型的截图和推理流是侧边栏。
  延迟在这里是有影响的，所以 Mode B 有自己的排行榜，绝不与 Mode A 混排。

## 里程碑

| 里程碑 | 范围 | 完成判据 |
|---|---|---|
| M0 | 引擎起步 | **已完成：** 引擎从我们自己的游戏文件初始化（273 张地图）；脚本 bot 把整局打到分出胜者，单进程 2 到 8 名玩家（`tools/scripted-match.mjs`）。**未完：** 一个端到端驱动进私人房间的浏览器客户端；Windows 98 路线验证通过或放弃（见下方清单） |
| M1 | Mode A，单模型 | 一个模型对内置脚本 bot，整局、决策日志、回放、成本报告 |
| M2 | Mode A，模型对模型 | Runner 跑一轮循环赛；Bradley-Terry/Elo 表；首映叠加层可用 |
| M3 | Mode B | 两个模型在两个 Chrome 实例里打完一局；实时叠加层；第一场直播 |
| M4 | 第 1 赛季 | 5-6 个模型；每对至少 30 局 Mode A；每周一场 Mode B 展示 |

Windows 98 路线清单（M0，最多两天）——**已被取代；留档备查。** Mode B 现在用
[experiments/xp-vm](experiments/xp-vm/) 里的 Windows XP 线。Windows 98 这条路是死路（见「现状」一节）：

1. QEMU/KVM 里的 Windows 98 SE + RA2（pentium3 CPU 型号、Cirrus VGA、PCnet/RTL8139 网卡、`-rtc clock=vm`）；RA2 跑 800x600。
2. 两台虚拟机在同一个共享 L2 网段上（`-netdev socket,mcast=...`），装好 IPX/SPX；一局 RA2 局域网对战能打完。
3. QMP 的 `screendump` 和 `input-send-event` 驱动「截图 -> 模型 -> 点击」一个循环。
4. 两台虚拟机 `stop` 30 秒再 `cont`；RA2 不能掉线。若成立，这条路线也能跑回合制。
5. 测出每台虚拟机的 CPU/内存占用，得出单宿主能跑几局。

## 跑一局

准备好 `MIX_DIR` 后，脚本 bot 之间可以无头对打。这是多人对战的底座：单进程 2 到 8 名玩家，不涉及 LLM。
之后再用模型驱动的 agent 替换脚本 bot。

```
MIX_DIR=~/ra2-mix node tools/scripted-match.mjs
MAP=mp03t4.map PLAYERS=4 MIX_DIR=~/ra2-mix node tools/scripted-match.mjs
```

每次运行会打印一条五分钟进度行、最终名次和一个 `.rpl` 回放路径。该回放能导入真实游戏客户端。

在 Apple M4 上实测：

| 对局 | 结果 | 墙钟时间 | 速度 |
|---|---|---|---|
| 1v1，mp06t2 | 29 游戏分钟后分出胜者 | 2.7 秒 | 649 倍实时 |
| 4 人混战，mp03t4 | 剩两个 bot，66 分钟上限时无胜者 | 14.3 秒 | 280 倍实时 |

第二行才是重点。脚本 bot 已经会僵持，所以赛事规则需要一个平局判定，以及按经济和军队价值的加时判优，而不是
假设每一局都会分出胜负。

安装说明：发布出的 bot 声明了对旧版引擎 API 的 peer 依赖，所以 `npm install` 需要加 `--legacy-peer-deps`。
上面这套组合已测试并能打通。

## 让模型来打

`tools/model-match.mjs` 把一个语言模型放在一边、脚本 bot 放在另一边。引擎只在 runner 调用它时才推进，所以
两次决策之间游戏是静止的：慢模型和快模型面对的是同一个局面，结果比的是「怎么打」而不是「答得多快」。

```
MIX_DIR=~/ra2-mix MODEL_BASE_URL=... MODEL_API_KEY=... MODEL_NAME=... node tools/model-match.mjs
```

模型决定造什么、以及推进还是按兵不动。那些不属于决策的机械操作——开局展开基地车、让矿车保持采矿、给造好的
建筑找一个合法的落点——对每个模型都用同样的方式处理，这样比较就不会被「谁给的坐标更好」主导。每一次决策都会
连同它的推理、token 数和延迟写进日志。

### 第一场分出胜负的对局

一个前沿模型对脚本 bot，双人地图：

| | |
|---|---|
| 结果 | **脚本 bot 获胜**；模型在 9.3 游戏分钟后被击败 |
| 决策 | 18 次，每次都干净解析，无一不可用 |
| 思考 | 每次约 6.6 秒，共约两分钟，全都不影响游戏进程 |
| 下达的进攻命令 | **零** |
| 阵亡时未花掉的资金 | 5,500 |

开局是稳的：电厂、矿场、兵营、战车工厂，然后是步兵。然后它就停了。最后四次决策什么都没要，任由五千块钱闲置、
敌人长驱直入。告诉它时间在走、把它自己反复的意图摊给它看、并说明僵持什么都赢不到——都没改变这一点。

这与唯一一个可比的公开结果一致：那里模型也是经济维持得不错、但每一局的战斗得分都是零。这是关于模型的发现，
不是 bug。由此有两点：赛事规则需要平局判定和按经济、军队价值的加时判优，而不是假设对局都会分出胜负；而且
「消极」需要作为一个独立维度来度量，因为一个模型可以从头到尾没在战斗里被打败却仍然输掉。

读它的推理会发现它并不糊涂。每条笔记都写着某种「攒一支部队，然后进攻」的意思，直到它临死前写下的那条也是。
它早就注意到敌方军队更大。它始终缺的是任何「正在输」的感觉：它能看到自己拥有什么，却看不到自己曾经拥有什么。

### 消极，已诊断并修复

试了两个杠杆。侦察在机制上是通的——巡逻队出去了、识别出九种敌方单位——但什么都没改变。而告诉这一方它损失了
多少单位和建筑、自上次下令以来损失了多少、以及是否有敌人正站在它的基地里——这改变了一切。

### 一名玩家一个 agent

这个项目真正要做的编排：每一边一个模型，双方面对同一个静止的局面做决策，谁答得快都不占便宜。

| | A 方 | B 方 |
|---|---|---|
| 决策 | 30 | 30 |
| 不可用回复 | 0 | 0 |
| 进攻命令 | 10 | 19 |
| 侦察出动 | 18 | 39 |
| 损失的单位和建筑 | 90 | 70 |
| 终局资金 | 3,075 | 10,925 |

双方都守了六分钟防线，然后在相差不到一分钟内投入进攻，打完了剩下的对局，彼此交换了一百六十个单位和建筑。
无一被消灭。按项目早已规划的加时判定——无人阵亡时比经济和军队价值——B 方在每个维度都赢：更富、损失更少、
更具攻击性、侦察更多。

这一局结束不是因为游戏僵住，而是因为决策预算用完了、双方在没有命令的情况下继续打。预算和决策节奏要按它们要
覆盖的对局长度来设定。

一个值得记住的数字：游戏本身模拟只花了约八秒。模型思考花了十九分钟。延迟在这里不影响结果，但它完全决定了跑完
一个赛季要多久。

## 待定问题

- 第 1 赛季的模型名单。
- Mode A 的决策节奏 K（起点：75 tick = 5 游戏秒）与脚手架层级（原始 vs 辅助）。
- Mode B 的游戏速度（倾向最慢，以缩小延迟惩罚）。
- 直播平台与形式；是否加一个 LLM 解说。
- 是否发布一个只读的结果页。
- 本仓库的许可协议。

## 游戏文件

**你必须拥有这些游戏。** 本项目不附带任何游戏或系统资产，也不提交任何受版权保护的东西。下面的下载链接是社区
存档镜像，只为**已经拥有正版**的人提供便利。《红色警戒 2》版权归 Electronic Arts；Windows XP 版权归
Microsoft。除非你拥有相应授权，否则不要下载；若版权方提出异议，这些链接就会撤下。

### 红色警戒 2（两种模式都需要）

引擎读取《红色警戒 2》的 `*.mix` 归档——只用基础版；装配脚本会跳过尤里的复仇/资料片归档，所以一个同时打包了
RA2 + 尤里的复仇的镜像也没问题。

**从 Steam 获取**（app 2229850）——最适合本地开发。它的 Windows depot 在 macOS 或 Linux 上也能下载，从客户端
控制台（`steam://open/console`，或用 `-console` 启动 Steam）：

```
download_depot 2229850 2229851 4928885831751969588
download_depot 2229850 2229852 2191822715159570153
```

第一个是基础游戏（约 1.9 GB），第二个是英文（约 1.2 GB）。其它语言 depot：2229853 德语、2229854 法语、
2229855 繁体中文、2229856 韩语。没有简体中文 depot，繁体中文包只有字幕，配音仍是英文。

然后装配一个 `MIX_DIR`，并检查引擎确实能读它：

```
tools/make-mix-dir.sh
MIX_DIR=~/ra2-mix node tools/engine-smoke.mjs
```

**从光盘镜像获取**——供容器化引擎（`Dockerfile.engine`）使用。一个 `.mix` 文件在根目录的整装游戏 ISO 可直接用；
容器的 `tools/assemble-engine-mix.sh` 会在启动时把它解压进 `MIX_DIR`（只取基础 RA2；跳过尤里的复仇归档）。
存档镜像（RA2 + 尤里的复仇，美/欧版）：
<https://archive.org/details/command-conquer-red-alert-2-yuris-revenge-usa-europe>

第一次上手最花时间的三件事：

- **引擎拒绝符号链接。** 由符号链接组成的 `MIX_DIR` 会以
  `IOError: File "language.mix" could not be read (TypeMismatchError)` 失败。用硬链接，它不占额外空间，但要求在
  同一个文件系统上。
- **macOS 上 Steam 客户端把 depot 写在它自己的 app bundle 里**，而不是 Steam 库
  （`.../Steam.AppBundle/Steam/Contents/MacOS/steamapps/content/app_2229850`），而且它打印的路径混用了正斜杠和
  反斜杠。磁盘上的目录用的是正斜杠。
- **靠跑引擎来验证，别靠算校验和。** 文件哈希对得上，也可能是引擎打不开的布局。

在 Apple M4 上、用基础 depot 加英文实测：273 张地图，一局 3000-tick、agent 空闲的对局模拟速度约每秒 35k tick。
那是没有命令、没有战斗时的上限值；带寻路的真实 bot 会慢得多。

### Windows XP（仅 Mode B）

Mode B 会在两台 Windows XP 客户机里安装《红色警戒 2》，所以它还需要 XP 安装介质和你自己的产品密钥。

- Windows XP Professional SP3——存档镜像：
  <https://archive.org/details/windows-xp-professional-sp-3-updated_202212> → 保存为 `winxp.iso`。
- 把**你自己的**产品密钥填进 `winnt.sif`（从 `experiments/xp-vm/winnt.sif.example` 复制）。
- 完整的构建与运行步骤：[experiments/xp-vm/README.md](experiments/xp-vm/README.md)。

## 环境要求

- 一份正版《红色警戒 2》（见上）以获取 `*.mix` 文件。
- Node.js 20 或更高（无头引擎）；Chrome（Mode B）。
- 一台 8-16 核的 Linux 机器跑并行对局；一台带 OBS 的直播机。
- Mode B 需要 Chrono Divide 玩家账号。

## 许可说明

- Chrono Divide 是一个专有的、非营利的粉丝重制。它的 game API 是为 bot 开发而发布的，但不带开源许可。本项目只
  消费它；不重新分发它的任何东西。
- 《红色警戒 2》的资产归 Electronic Arts。本项目不附带任何资产。
- 我们会在直播里致谢 Chrono Divide，并打算与其作者协调。
- AI 生成的解说会在平台规则要求处标注。

## 参考

- 可行性研究：[docs/research/2026-09-09-feasibility.md](docs/research/2026-09-09-feasibility.md)
- Chrono Divide：https://chronodivide.com/ ；Game API：https://www.npmjs.com/package/@chronodivide/game-api
- 相关工作：OpenRA-RL、TextStarCraft2、SC2Arena、VideoGameBench、Kaggle Game Arena（链接见研究文档）
