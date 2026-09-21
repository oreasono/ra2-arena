# ra2-arena

[English](README.md) · **简体中文**

一个让大语言模型互相对战《命令与征服：红色警戒 2》的竞技场。每一局都会产出一个回放、一份逐步决策日志和一个结果。

两种跑对局的方式：

- **无头引擎** —— 模型对模型（或对内置脚本 bot），跑在
  [`@chronodivide/game-api`](https://www.npmjs.com/package/@chronodivide/game-api) 引擎上。引擎只在
  runner 向模型要命令时才推进，所以慢模型和快模型面对的是同一个局面，比的是「怎么打」而不是「答得多快」。
- **真实 Windows XP 客户机** —— 两台 QEMU/KVM 客户机打一局局域网对战，一个视觉模型看着画面驱动其中一方。
  见 [experiments/xp-vm](experiments/xp-vm/)。

本项目不附带任何受版权保护的东西：**请自备一份《红色警戒 2》**（走 Windows 这条路的话，还要自备 Windows XP
安装介质）。模型 API key 只放在 `.env`。

## 游戏文件

**你必须拥有这些游戏。** 本项目不附带任何游戏或系统资产，也不提交任何受版权保护的东西。下面的下载链接是社区
存档镜像，只为**已经拥有正版**的人提供便利。《红色警戒 2》版权归 Electronic Arts；Windows XP 版权归
Microsoft。除非你拥有相应授权，否则不要下载；若版权方提出异议，这些链接就会撤下。

### 红色警戒 2（两种模式都需要）

引擎读取《红色警戒 2》的 `*.mix` 归档——只用基础版；装配脚本会跳过尤里的复仇/资料片归档，所以一个同时打包了
RA2 + 尤里的复仇的镜像也没问题。

**从 Steam 获取**（app 2229850）——最适合本地开发。它的 Windows depot 在 macOS 或 Linux 上也能下载，从客户端
控制台（`steam://open/console`，或用 `-console` 启动 Steam）下载后装配一个 `MIX_DIR`：

```
download_depot 2229850 2229851 4928885831751969588   # 基础游戏，约 1.9 GB
download_depot 2229850 2229852 2191822715159570153   # 英文，    约 1.2 GB
tools/make-mix-dir.sh
MIX_DIR=~/ra2-mix node tools/engine-smoke.mjs        # 验证引擎能读它
```

其它语言 depot：2229853 德语、2229854 法语、2229855 繁体中文、2229856 韩语。没有简体中文 depot，繁体中文包
只有字幕。两个坑：引擎拒绝符号链接（用硬链接，且要在同一文件系统），macOS 上 Steam 客户端把 depot 写在它自己的
app bundle 里、不是 Steam 库。

**从光盘镜像获取**——供容器化引擎（`Dockerfile.engine`）使用。一个 `.mix` 文件在根目录的整装游戏 ISO 可直接用；
容器的 `tools/assemble-engine-mix.sh` 会在启动时把它解压进 `MIX_DIR`（只取基础 RA2）。存档镜像（RA2 + 尤里的
复仇，美/欧版）：<https://archive.org/details/command-conquer-red-alert-2-yuris-revenge-usa-europe>

### Windows XP（仅 Mode B）

Mode B 会在两台 Windows XP 客户机里安装《红色警戒 2》，所以它还需要 XP 安装介质和你自己的产品密钥。

- Windows XP Professional SP3——存档镜像：
  <https://archive.org/details/windows-xp-professional-sp-3-updated_202212> → 保存为 `winxp.iso`。
- 把**你自己的**产品密钥填进 `winnt.sif`（从 `experiments/xp-vm/winnt.sif.example` 复制）。
- 完整的构建与运行步骤：[experiments/xp-vm/README.md](experiments/xp-vm/README.md)。

## 跑一局

无头模式，先准备好 `MIX_DIR`（见上）。先用脚本 bot——不涉及模型，单进程 2 到 8 名玩家：

```
MIX_DIR=~/ra2-mix node tools/scripted-match.mjs
MAP=mp03t4.map PLAYERS=4 MIX_DIR=~/ra2-mix node tools/scripted-match.mjs
```

把语言模型放到一方或双方：

```
MIX_DIR=~/ra2-mix MODEL_BASE_URL=... MODEL_API_KEY=... MODEL_NAME=... node tools/model-match.mjs
```

每次运行会打印进度和最终名次，并写出一个 `.rpl` 回放（可导入真实游戏客户端）以及一份逐步决策日志（每次决策的
提示、回复、延迟和成本）。

Windows XP / 视觉模型这条路见 [experiments/xp-vm](experiments/xp-vm/)。

安装说明：bot 声明了对旧版引擎 API 的 peer 依赖，所以 `npm install` 需要加 `--legacy-peer-deps`。

## 环境要求

- 一份正版《红色警戒 2》（见[游戏文件](#游戏文件)）以获取 `*.mix` 文件。
- Node.js 20 或更高（无头引擎）。
- Linux 上的 QEMU/KVM 加 Windows XP 安装介质（Mode B）。

## 许可说明

- 《红色警戒 2》的资产归 Electronic Arts；Windows XP 归 Microsoft。本项目两者都不附带，也不提交任何游戏或系统资产。
- Chrono Divide（`@chronodivide/game-api`）是一个专有的、非营利的粉丝重制，为 bot 开发而发布。本项目只消费它，
  不重新分发它的任何东西。

## 参考

- Chrono Divide：<https://chronodivide.com/> · Game API：
  <https://www.npmjs.com/package/@chronodivide/game-api>
