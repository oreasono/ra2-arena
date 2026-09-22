# Jev / System One 接入 ra2-arena 调研

日期：2026-09-21

状态：决策备忘录，仅调研与粗设计；未修改运行时代码，未增加依赖

范围：`packages/model-bot/model-client.mjs`、模型自对弈及其 `result.json`、
`decisions.jsonl`、`match.rpl` 三类证据产物

## 结论

**可以接，但不应把 Jev 当成另一个 chat-completions 模型。** Jev 最适合在代码先生成的、
已做合法性过滤的有限动作集合中作战术判断；它不适合生成自由文本计划，也不适合独自负责
算术、计数、坐标、建造条件或长程规划。接入边界应是一个后端无关的 `DecisionBackend`，
而不是继续扩展当前 `ModelClient.ask()`。

建议分两次批准：

1. 先批准 **S 档（1-2 天）**，用固定的公开局面快照比较 Jev 与当前 chat 后端的动作、
   延迟、费用和本地可执行率；不改变正式赛季默认后端。
2. S 档通过后再批准 **M 档（3-5 天）**，完成后端抽象、Jev 适配器、chat 兼容适配器、
   版本化决策证据和回归测试。

异构双边配置、多个网关同时路由、看板和自动 fallback 属于 **L 档（1-2 周）**，仍在当前
本提案范围之外内，不应借本次调研提前实现。

## 1. 实际 API 形状

### 1.1 TypeSafe 原生接口

原生调用不是 OpenAI chat completions：

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json
```

`state` 可为字符串、对象或数组；`questions` 是由调用方命名的 typed-question map：

```json
{
  "model": "jev-1.13.0",
  "state": {
    "tick": 9000,
    "credits": 4200,
    "ownArmy": { "GI": 6 },
    "visibleEnemy": { "E1": 4 },
    "legalActions": ["hold", "attack_move_enemy_base"]
  },
  "questions": {
    "stance": {
      "type": "choice",
      "instructions": "Choose the best legal stance for this state.",
      "criteria": {
        "hold": "Keep the army near the base.",
        "attack_move_enemy_base": "Commit the current army to the enemy base."
      }
    },
    "base_threatened": {
      "type": "noul",
      "instructions": "Is the visible enemy an immediate threat to the base?"
    },
    "risk": {
      "type": "score",
      "instructions": "Rate the risk of committing the current army.",
      "criteria": ["low", "medium", "high"]
    }
  }
}
```

| 类型 | 请求 | 返回 | 约束 |
| --- | --- | --- | --- |
| `noul` | yes/no 判断，可选 true/false rubric | `noul: 0..1` | 值是“yes”的概率 |
| `choice` | option -> rubric 的 map | `choice`、完整 `probabilities`、`confidence` | 最多 255 个选项 |
| `score` | 有序 rubric 数组 | 插值 `score`、`legend`、完整 `probabilities`、`confidence` | 2-10 档 |

响应还包含实际执行的版本化 `model` 和 `usage.input_tokens/output_tokens`。原生 HTTP 错误中，
`429` 与 `529` 应退避重试；`401` 是鉴权失败，`422` 是请求 schema 错误。生产证据必须记录
响应里的固定版本，例如 `jev-1.13.0`，不能只记录会移动的 `jev-latest`。

同一请求内的问题共享一次 `state` 并行求值，但协议没有“后一题读取前一题答案”的依赖关系。
有依赖的计划要么做两次调用，要么由代码预先折叠成有限的复合候选计划。

### 1.2 已验证的网关形态

| 路径 | Endpoint / model | 鉴权 | 判断 |
| --- | --- | --- | --- |
| TypeSafe 原生 | `POST https://api.typesafe.ai/v1/systemone`；`jev-1.13.0` | TypeSafe Bearer key | 最短路径，保留原生 `noul/choice/score` |
| Vercel TypeSafe-compatible | `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone`；`typesafe-ai/jev` | AI Gateway key 或 Vercel OIDC；可 BYOK | 保留 TypeSafe schema，并增加 gateway routing/cost metadata |
| Vercel Evaluation | `POST https://ai-gateway.vercel.sh/v1/evaluate`，或 AI SDK 7 `experimental_evaluate` | 同上 | 标准化为 `boolean/choice/score`；不是 chat endpoint |
| OpenRouter Decisions alpha | `POST https://openrouter.ai/api/alpha/decisions`；`typesafe/jev-1.13` | OpenRouter Bearer key | schema 基本同原生，响应增加 `id`、`provider`、`usage.cost`；路径不在 `/api/v1` 下 |
| Cloudflare AI Gateway | 无已验证的原生 TypeSafe provider | 取决于自定义 provider/upstream | 可用 custom provider 代理原生接口，但它不是 Jev 的已验证转售或免 key 入口 |

因此，**Vercel 和 OpenRouter 确实都能调用 Jev，但都不能复用当前
`/chat/completions` 调用。** Vercel 文档也明确说 evaluation 不支持其 OpenAI-compatible、
Anthropic-compatible 或 Cohere-compatible endpoints。

调查中两个容易误判的点：OpenRouter 的普通模型页和 `/api/v1/models` 不列 Jev，并不表示
没有接入；它位于独立的 alpha Decisions API。`jevtypesafeai.com` 自称独立站点，不是 TypeSafe
官方来源，本方案不把它作为依赖或证据。

## 2. 社区 RA2 harness

找到了直接的社区实现，而不是只有类比项目：
[`ra2web/ra2web.github.io` 固定提交 `7f6858a`](https://github.com/ra2web/ra2web.github.io/tree/7f6858ac8c1d1b7e6c9c5d84dcc1e9af1df3a06c)。
其文档为
[`docs/jev-player-local.md`](https://github.com/ra2web/ra2web.github.io/blob/7f6858ac8c1d1b7e6c9c5d84dcc1e9af1df3a06c/docs/jev-player-local.md)，
玩家实现为
[`werhd-jev-player.mjs`](https://github.com/ra2web/ra2web.github.io/blob/7f6858ac8c1d1b7e6c9c5d84dcc1e9af1df3a06c/docs/examples/jev/werhd-jev-player.mjs)。
LangChain 的 “Building a harness with Jev” 是通用分类器示例，不是 RA2 harness。

该实现的关键流水线是：

```text
公开玩家 API 的可见状态
  -> 代码裁剪、计数、生成当前合法候选
  -> 最多 8 个并行 Choice 问题
  -> Jev 返回候选 ID、概率分布、置信度
  -> 本地 ID -> 具体 action
  -> 检查陈旧、所有权、队列、资金、目标和重复任务
  -> 调玩家 API
  -> 记录后续 observation 与结算
```

映射细节对 ra2-arena 有直接参考价值：

- `state` 只含可见信息：tick/time、己方经济/电力/基地/军队/队列、可见敌军及威胁、
  侦察记忆；不读取隐藏敌方状态。
- 代码按建设、车辆、步兵、部署姿态、战术、侦察、特殊行动和投资等分组生成候选；
  每个 Choice 的 key 是短 action ID，实际单位 ID、坐标、费用和执行函数留在本地 map。
- 一次只提交至多 8 个有两个以上候选的分组。建筑落点、空间搜索、计数、武器比较、
  采矿、维修和近距离集火由确定性代码负责。
- 响应跨越 180 个模拟 tick 就丢弃；执行前重新检查单位仍归己方、敌人仍可见、
  队列和资金未改变、姿态未已切换，并避免重复持续任务。
- `accepted` 仅表示通过本地检查并调用了玩家 API，不等于模拟已经完成动作；是否生效要由
  后续 observation、画面或最终结算证明。

其 v6 自报的一局完整策略结果是 16:24 战胜简单 AI：124 次请求、0 次上游失败，
P50 369ms、P95 870ms、最大 1876ms，547,158 input tokens，97 次提交指令、7 次建筑落地。
这是**社区单局、单地图、单难度的自报结果，不是独立 benchmark，也不是胜率**。同一文档还
记录了前两局失败、后续桥梁地图在中途改策略后获胜、水域地图失败，并明确 v8.3 尚未做完整
整局回归。

结论不是“Jev 已证明会玩 RA2”，而是“候选生成 + typed judgment + 本地复核”这条工程路径
已经跑通过一整局，并暴露了生产停滞、经济恢复、特殊地形和策略迭代等真实限制。

## 3. ra2-arena 的后端抽象

### 3.1 当前耦合点

当前 [`model-client.mjs`](../../packages/model-bot/model-client.mjs) 固定调用
`/chat/completions`，返回 assistant text；[`model-bot.mjs`](../../packages/model-bot/model-bot.mjs)
再从文本抽 JSON，并校验 `{notes, build, train, stance}` 的外形。这个边界同时混合了传输协议、
模型输出格式与 RA2 计划，无法自然容纳 typed questions。

### 3.2 建议边界

`ModelBot` 负责领域部分：构造规范化 observation、生成有限合法候选、应用计划和执行前复核。
后端只负责从同一 observation/candidates 产生一个领域计划和可审计证据：

```text
DecisionRequest
  observation       规范化、仅可见、可安全落盘的状态
  candidateGroups   group -> {actionId -> rubric + deterministic payload}
  history           最近意图/结果的有界摘要
  mappingVersion    候选生成与 answer->plan 映射版本

DecisionResult
  plan              后端无关的规范化计划，或 null
  requestedModel    请求使用的 model ID
  resolvedModel     响应报告的版本；能固定时必须固定
  backend/provider  chat、typesafe、vercel 或 openrouter
  evidence          tagged union，保留该后端的原生证据
  usage/latency/id  token、费用、端到端耗时、provider request ID
```

适配器职责：

- `ChatDecisionBackend`：保留现有 system/user prompt 与 JSON-plan 解析，逐步改为从
  `candidateGroups` 提供的 ID 里选；不能因为接入 Jev 而改变现有基线行为。
- `JevDecisionBackend`：把每个独立动作组变成 `choice`，必要时用 `noul` 做绝对阈值判断、
  用 `score` 做粗粒度风险；把返回 ID 确定性映射成同一种 `plan`。
- `ModelBot`：对两个后端使用同一 `isValidPlan`/运行时合法性检查、陈旧判断、候选映射和
  执行逻辑。后端不能直接触碰 game API。

对当前 `{build[], train[], stance}`，第一版不应让 Jev“生成数组”。代码可给出有限的
`structure_plan`、`production_plan`、`stance` 候选，每个候选本身可以是一个小型复合 payload；
Jev 只选 ID。并行问题之间可能冲突，故应用时要用稳定顺序并在每一步后重验，失效动作记为
rejected，而不是把 type safety 当作游戏合法性。

### 3.3 必须继续留在代码里的工作

- 资金、电力、数量、距离、队列容量和冷却计算。
- 可生产/可部署/可到达性过滤，建筑落点与具体坐标。
- 候选上限、重复任务合并、陈旧响应和失效单位处理。
- 动作执行、fallback、超时/退避，以及对 match 是否继续的判断。
- 长期策略记忆的压缩与显式状态。Jev 只看本次 state，不是自主 planner。

这也符合 TypeSafe 对 Jev 1.13 的官方限制：它可能过度字面化，不擅长计数与数值精度、
多层间接推理和无关信息很多的长 state；结构恒等式也不保证，并且不适合文本生成。

## 4. 三类证据产物

### `match.rpl`

回放格式和双边动作覆盖校验不需要概念性改变。它仍是“游戏实际收到哪些命令”的证据，
但不能单独证明每条模型回答如何映射成命令。

### `result.json`

保留 match ID、胜负、replay hash、每边 decision/valid/action 计数。每个 side 需要新增或泛化：

- `backend`、`provider`、`requestedModel`、`resolvedModel`，不能只依赖全局 `MODEL_NAME`；
  provider 只返回移动 alias 时要如实保留，不能伪装成固定版本。
- input/output tokens、provider cost（有则记录）、P50/P95/总推理耗时、失败/超时/陈旧数。
- selected、locallyValid、accepted、observedApplied 分开统计；不要把低置信度等同于 invalid。

### `decisions.jsonl`

建议升为版本 2 的 tagged union，而不是为 Jev 伪造“推理文本”：

```json
{
  "schemaVersion": 2,
  "matchId": "...",
  "side": "ModelA",
  "tick": 9000,
  "backend": "typesafe-system-one",
  "provider": "typesafe",
  "requestedModel": "jev-1.13.0",
  "resolvedModel": "jev-1.13.0",
  "mappingVersion": "ra2-plan-v1",
  "requestId": null,
  "stateHash": "sha256:...",
  "state": {},
  "candidateGroups": {},
  "evidence": {
    "kind": "typed-questions",
    "questions": {},
    "answers": {}
  },
  "reasoning": null,
  "reasoningKind": "none",
  "mappedPlan": {},
  "valid": true,
  "latencyMs": 420,
  "usage": { "inputTokens": 3200, "outputTokens": 40, "costUsd": 0.0001344 }
}
```

完整 `answers` 应保留所有 probabilities/confidence，不只保留赢家。由 adapter 生成的摘要意图要
标 `source: "adapter"`，不能冒充模型推理。chat 后端用另一种 `evidence.kind` 保存 prompt、
原始回复和 parsed plan；`valid` 始终由本地 `isValidPlan(plan)` 与运行时检查产生。

所有落盘 state 必须经过 public-safe 投影；不得记录 Authorization header、API key 或网关凭据。
可解析时固定模型版本，并始终记录 requested/resolved model、问题版本、候选/映射版本和
state hash；provider 只暴露 alias 时，该局只能做到“证据可审计”，不能宣称模型位级可复现。

## 5. 同类与对照模型

截至本次调查，没有找到另一个公开服务同时提供 Jev 这组能力：任意 typed questions、同 state
并行回答、Choice 全概率分布和声明的 confidence。可用对照分为三类：

| 类别 | 候选 | RA2 用法 | 与 Jev 的主要差异 |
| --- | --- | --- | --- |
| Zero-shot 分类 | Hugging Face zero-shot NLI，如 `facebook/bart-large-mnli` | state + action labels，选一个 label | 只覆盖分类；归一化 label score 没有校准承诺；托管延迟取决于 provider，也可自托管 |
| Reranker | Voyage Rerank、Cohere Rerank | state/objective 作 query，合法动作作 documents，取 top-1 | 返回 relevance score，不是概率或 confidence；只排序，不回答混合 typed questions |
| 通用 LLM 结构化输出 | OpenAI Structured Outputs、Gemini Structured Outputs | 继续生成完整 JSON plan | 保证 schema 形状，不保证语义、游戏合法性或概率校准；仍是自回归生成模型 |

对日志而言，分类器应记 `labelScores`，reranker 应记 `relevanceScores`，不能统一改名为
`confidence`。OpenAI/Gemini 即使 schema 100% 合法，也必须继续走 `isValidPlan` 和运行时复核。

## 6. 成本、延迟和可用性

TypeSafe 2026-09-21 的 Jev 1.13 文档价为 **$0.042 / 百万 input tokens，output 免费**；
限制为 250k tokens/s、1200 requests/min，且官方注明会动态调整。上下文为每请求 64k tokens，
同时 `state + 最长单题` 不得超过 32k；输入只支持文本或由文本值构成的结构化数据。

按社区 v6 单局的 547,158 input tokens 粗算，原生标价约 **$0.023/边/局**，两边同量约
**$0.046/局**，未含网关费用，也不能外推到我们的候选和 cadence。需要在 S 档用 ra2-arena
真实 state 重新量测。

TypeSafe 发布文称其服务位于美国西海岸，端到端 70-500ms；同时产品仍为 early access，
按 waitlist 放量。这是供应商口径，不是 SLA。社区 RA2 单局的 P95 870ms 和 max 1876ms 更适合
作为容量预期；我们的一次 RA2 局面 spot check 约 1.4s，也说明不能按最低宣传值规划。

当前引擎在 `think()` 时暂停，因此延迟不会给某一方游戏内优势，但会直接决定赛季墙钟时间。
网关提供不直接持有 TypeSafe key 的另一条调用、结算和观测路径，但具体账号是否可用仍需探针
确认，并会增加一层价格、限流和故障域；OpenRouter Decisions 目前还带 `alpha` 路径，
稳定性要单独验收。

## 7. 主要风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 把“类型安全”误当“行动正确” | 合法 enum 仍可能是坏策略或已失效动作 | 候选先过滤，执行前重验，后续 observation 验证 |
| RA2 长期战略超出 System One | 局部判断合理但经济/军力长期停滞 | 代码维护显式战略阶段与约束；Jev 只做有界战术选择 |
| 并行问题互相冲突 | 同轮建设/生产/战术答案组合后非法 | 复合候选或稳定应用顺序；每步重验，不假设跨题一致性 |
| 数字、计数与长 state 退化 | 资金门槛、兵力统计或目标比较错误 | 代码算数并语义化分桶；只发送问题需要的字段 |
| 置信度被误读为胜率 | 看板和自动阈值产生错误含义 | 明示“选项判断置信度”；用自有标注做 Brier/ECE 校准 |
| 模型别名漂移 | 同一配置无法复现 | 能固定则固定；分别记录 requested/resolved model；只返回 alias 的网关标为证据缺口；升级走回归门 |
| early access / alpha / 无 SLA | 赛季中断或吞吐变化 | 超时、退避、失败记证据；保留 chat backend；赛季前探活 |
| 供应商/网关锁定 | 配置、计费、错误语义分裂 | 后端接口与 provider metadata 分层；不把网关字段写进领域 plan |
| 敏感或对抗性 state | 数据泄漏或判断被 state 文本操纵 | 仅 public-safe 投影，精确 criteria，敌方文本不作为指令 |

## 8. 工作量与验收建议

### S：1-2 天，离线 spike

- 从现有决策证据抽取一组固定、无密钥、只含可见信息的局面快照。
- 为每个快照生成有限动作候选，同时调用一个固定 Jev 版本和当前 chat baseline。
- 报告 schema 成功率、本地合法/可执行率、动作分歧、P50/P95、tokens 和每决策费用。
- 至少验证原生路径；Vercel 或 OpenRouter 选一条做等价性探针，不同时铺三套生产配置。

### M：3-5 天，生产化单后端能力

- 落地 `DecisionBackend`、chat adapter、Jev adapter 和统一候选生成/映射。
- `decisions.jsonl` v2、`result.json` backend 字段及证据校验向后兼容。
- 超时/退避/陈旧响应/非法候选/移动 alias 等单元与集成回归。
- 固定地图做 model-v-model smoke，证明三产物仍互相对应且不泄漏凭据。

### L：1-2 周，本提案范围之外

- 每边独立 backend/provider/model，网关路由和 fallback。
- 置信度校准、赛季看板、费用预算、批量地图/阵营回归及运维告警。
- 这部分会改变 driver/多模型产品面，属后续单独决定。

S 档的 go/no-go 不应看单局胜负，而应看：响应和证据是否完整、计划能否由本地稳定映射并执行、
P95 与每决策成本是否优于或至少可接受于 chat baseline。胜率要在策略和地图固定后用多局评估，
社区单局胜利不能替代这一步。

## 来源

以下页面均于 2026-09-21 UTC 查阅：

- TypeSafe：[HTTP API](https://docs.typesafe.ai/api)、[models / price / limits](https://docs.typesafe.ai/models)、
  [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)、
  [launch / latency / access](https://typesafe.ai/blog/introducing-system-one-models-and-jev)。
- Vercel：[TypeSafe-compatible API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)、
  [Evaluation API](https://vercel.com/docs/ai-gateway/modalities/evaluation)。
- OpenRouter：[Decisions API reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request)、
  [Jev verified cascade recipe](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/jev-verified-cascade)。
- Cloudflare：[provider integrations](https://developers.cloudflare.com/ai-gateway/usage/providers/)、
  [custom providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)。
- RA2Web：上述固定提交的
  [接入文档](https://github.com/ra2web/ra2web.github.io/blob/7f6858ac8c1d1b7e6c9c5d84dcc1e9af1df3a06c/docs/jev-player-local.md)
  与[玩家实现](https://github.com/ra2web/ra2web.github.io/blob/7f6858ac8c1d1b7e6c9c5d84dcc1e9af1df3a06c/docs/examples/jev/werhd-jev-player.mjs)。
- LangChain：[Building a harness with Jev](https://www.langchain.com/blog/building-a-harness-with-jev)。
- 近邻方案：[Hugging Face zero-shot classification](https://huggingface.co/docs/inference-providers/tasks/zero-shot-classification)、
  [BART-MNLI model card](https://huggingface.co/facebook/bart-large-mnli)、
  [Voyage Rerank](https://docs.voyageai.com/docs/reranker)、
  [Cohere Rerank](https://docs.cohere.com/reference/rerank)、
  [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)、
  [Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output)。
