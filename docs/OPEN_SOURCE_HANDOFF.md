# 开源维护交接报告（OPEN_SOURCE_HANDOFF）

本文件随公开版本提交，供后续维护者/Agent 接手。内容与最终代码一致。**不含**任何本地机器路径、原作者环境信息、密钥或个人做题记录。

## 1. 改动摘要与完成状态

本仓库由一个绑定作者个人 CloudBase 环境的私有项目整理为**可公开发布、由部署者自带云环境**的开源模板。主要改动：

- **去除个人身份硬编码**：云函数不再写死环境 ID / 邮箱 / UID，改为运行时从函数环境变量 `MATH2_ENV_ID` / `MATH2_ALLOWED_EMAIL` / `MATH2_ALLOWED_UID` 读取；缺失时报 `CONFIG_MISSING`，不会回退到任何默认账号。
- **前端环境 ID 外置**：`cloud-entry.js` 用构建期占位符 `__MATH2_ENV__` / `__MATH2_REGION__`，由 `scripts/build.cjs` 从 `.env` 注入；源码与产物不含作者环境 ID。
- **脚本去硬编码**：`scripts/sql.cjs`、`scripts/deploy.cjs` 从 `.env`/`-e` 读取环境 ID；`cloudbaserc.json` 的 `envId` 置空，部署时临时注入并还原。
- **版权内容剔除**：移除全部真题/书扫图片与真实题库（约 60MB、945 题），改为 `scripts/make-demo-bank.cjs` 生成的**虚构示例题库**（10 题 + 1 张程序生成的示意图）。`private/` 与函数 `assets/` 均被 git 忽略，示例题库按需生成。
- **数据库初始化去个人化**：`schema.sql` 由 `setup.cjs` 用 `engine.initial()` 重新生成（全新随机 epoch、空 records），不携带任何作者状态。
- **测试改造**：身份与计数改为从环境变量与示例题库动态推导，去除写死的 218/727/13、真实 UID/邮箱、`remaining38-ids.json` 与命中线上正式站点的 `live-*.cjs`。
- **UI 文案中性化**：移除指向特定出版物的可见文案（书名、年份、「原书题面/解析」等表述），改为「分册（示例）」等中性标签；结构性 ID 命名空间 `cxyonly:`/`lilin880:` 保留（被多处校验正则共用，改名属大范围重构）。
- **新增**：`LICENSE`(MIT)、`NOTICE.md`、`.env.example`、`scripts/install.cjs`、`scripts/deploy.cjs`、`scripts/env.cjs`、`docs/DEPLOYMENT.md`、`docs/AGENT_DEPLOY.md`、本报告；强化 `.gitignore`。
- **删除**：一次性代码改写脚本（`integrate.cjs`/`refine.cjs`/`position-fix.cjs`，对已迁移文件做字符串替换、非幂等、会损坏当前代码）、旧版 `storage.original.js`、命中正式站点的 `live-*.cjs`。

完成状态：本地构建、Node 测试（19 项）与三套浏览器测试（Edge）均通过；隐私/版权清理与产物扫描通过。**真实云端部署未执行**（见第 9 节）。

## 2. 技术栈、目录结构、主要入口

- 前端：原生 ESM + PWA（Service Worker + IndexedDB），KaTeX/marked/DOMPurify（`public/vendor/`）。
- 后端：CloudBase 云函数（Node.js 20），esbuild 打包为 `functions/math2-api/index.js`。
- 数据库：CloudBase PostgreSQL，私有 schema `math2_private`。
- 构建/工具：esbuild、`@cloudbase/cli`(tcb)、`@cloudbase/manager-node`、fake-indexeddb、playwright。

主要入口：
- 前端入口：`public/index.html` → `public/app.js`（启动 `boot()`）→ `public/cloud.js`（`startCloud`/`api`/`syncNow`）。
- 云函数入口：`functions/math2-api/handler.cjs` 的 `exports.main`（打包后 `index.js`，handler `index.main`）。
- 同步引擎：`functions/math2-api/engine.cjs`（`initial`/`apply`）。
- 本地脚本入口：`scripts/install.cjs`、`scripts/deploy.cjs`、`scripts/build.cjs`、`scripts/setup.cjs`、`scripts/make-demo-bank.cjs`、`scripts/serve.cjs`、`scripts/sql.cjs`。

目录：
```
public/        前端外壳与渲染库（静态托管根）；vendor/cloudbase.js 与 sw.js 为构建产物
functions/math2-api/  handler.cjs engine.cjs package.json；assets/ 与 *.json 清单、index.js 为生成物
private/       题库与图片（git 忽略；示例由脚本生成）
scripts/ tests/ docs/
schema.sql     生成物（git 忽略）
```

## 3. 核心模块与数据流

- **鉴权**：前端 `cloud.js` 用 CloudBase 邮箱验证码登录取 session；调用云函数时带 `accessToken`。`handler.identity()` 先请求 `https://<env>.api.tcloudbasegateway.com/auth/v1/user/me` 校验会话，再核对 `MATH2_ALLOWED_UID` 与 `MATH2_ALLOWED_EMAIL`，只放行登记账号。
- **题库下发**：题库与图片是受保护资源，随函数打包在 `assets/`。前端 `prepareContent()` 取 `manifest`，分批 `assetBatch` 下载，逐个 SHA256 校验后写入 CacheStorage；`math2ImageUrls` 把图片路径映射为 blob URL 供 `render.js` 使用。旧客户端（`clientVersion!==2`）走 `legacy-assets-manifest.json` + `legacy-bank.json`。
- **本地存储**：`public/storage.js` 用 IndexedDB（`records`/`meta`/`ops`）。记录先写本地事务再上传；`ops` 是待同步队列，含操作顺序与依赖（`base` 指向前一操作 ID）。
- **同步引擎**：`engine.cjs` 的 `apply(state,request)` 处理 `sync`/`restore`/`preview`。字段级版本（`fieldVersions`）+ 操作指纹去重（`receipts`）+ 冲突收集（`conflicts`/`noteConflicts`）。服务端用整个状态文档的数据库 `revision` 做条件更新，失败重读重算（最多 6 次），避免并发覆盖。
- **恢复**：`restore` 在一条 SQL 内完成条件更新与旧快照归档（写入 `restores`），并更换 `epoch` 阻断旧队列回灌。前端 `adoptRestoredCloud` 要求完整快照并校验导出后本机是否变动，在单个本地事务内替换。

数据流（写）：UI 编辑 → `storage.saveRecord`（本地事务，入 `ops`）→ `cloud.syncNow` → `api('sync')` → `handler` 鉴权 → `engine.apply` → 条件 UPDATE `state` → 响应 ack/records → `storage.acceptSync` 清理已确认 ops。

## 4. 数据表结构（`math2_private`）

- `state(id integer PK CHECK(id=1), revision bigint NOT NULL DEFAULT 0, data jsonb NOT NULL)`：单例状态文档。`data` 形如 `{epoch, seq, records{}, receipts{}, position, positions{}}`。`revision` 用于乐观并发条件更新。
- `restores(epoch text PK, data jsonb NOT NULL, created_at timestamptz DEFAULT now())`：每次恢复归档的旧快照。
- 两表启用 RLS，并 `REVOKE ALL ... FROM PUBLIC,anon,authenticated`：禁止前端直接访问，只能经云函数（运行时临时凭据）。

## 5. 腾讯云与外部服务用途

- **CloudBase 静态网站托管**：托管 `public/`（前端外壳）。题库/图片不在此。
- **CloudBase 云函数**：`math2-api`，鉴权、题库下发、同步与恢复。
- **CloudBase PostgreSQL**：`math2_private` 状态与恢复历史。
- **CloudBase 身份认证**：邮箱验证码登录；提供 `user/me` 供函数二次校验。
- 无其它第三方服务；无 AI/模型接口（如未来接入，须另行声明许可与费用）。

## 6. 配置项、环境变量与前后端边界

| 变量 | 边界 | 用途 | 敏感 |
|---|---|---|---|
| `CLOUDBASE_ENV` | 前端构建 + 脚本 | 环境 ID，构建期注入前端 | 否（公开标识） |
| `CLOUDBASE_REGION` | 前端构建 + 脚本 | 地域 | 否 |
| `MATH2_ENV_ID` | 服务端（函数环境变量） | 函数拼接鉴权网关地址 | 否 |
| `MATH2_ALLOWED_UID` | 服务端 | 唯一允许账号 UID | 是（个人标识） |
| `MATH2_ALLOWED_EMAIL` | 服务端 | 唯一允许账号邮箱 | 是（个人信息） |
| `MATH2_REGION` | 服务端 | 函数地域覆盖 | 否 |
| `TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN` | 服务端（运行时自动注入） | 函数访问数据库临时凭据 | **是（密钥）** |

边界规则：**前端只含公开环境 ID**（构建期注入，进入 `public/vendor/cloudbase.js`）；**UID/邮箱/密钥只在服务端**（函数环境变量或运行时注入），绝不进入浏览器代码或版本库。`.env` 被 git 忽略；`deploy.cjs` 注入函数环境变量到 `cloudbaserc.json` 后**立即还原**，避免凭据入库。

## 7. 准确命令

```bash
npm ci                          # 安装依赖
npm run demo-bank               # 生成虚构示例题库（仅示例）
npm run setup                   # private/ -> assets/ + 清单 + 空 schema.sql
npm run build                   # 构建前端与云函数（需 CLOUDBASE_ENV）
npm test                        # Node 测试（engine/storage/auth/healthcheck/banks，19 项）
npm run serve                   # 本地静态预览 http://127.0.0.1:8787
node scripts/install.cjs        # 本地一键：demo-bank(如需)->setup->build->test
# 浏览器测试（需本机 Edge/Chrome；先 demo-bank+setup+build）
npm run test:browser            # 单分区离线/保存/图片/移动端
npm run test:banks-browser      # 双分区笔记隔离/跨设备/章节遍历
npm run test:compat             # 降级兼容（无 SW/无 CacheStorage/旧 API/IndexedDB 不可用）
# 云端（需用户授权 + tcb login）
node scripts/deploy.cjs --dry-run
node scripts/deploy.cjs
```

## 8. 安装脚本流程、重复执行行为与已知限制

- `install.cjs`：检查 Node ≥20.19 与 `node_modules`；`private/data/bank.json` 不存在→生成示例题库，存在且 `mode==="demo"`→刷新，存在且非 demo→**跳过以保护已导入题库**（`--force-demo` 才覆盖）；随后 `setup`→`build`（无 `CLOUDBASE_ENV` 时用占位值并警告）→`test`。`--skip-test`/`--skip-demo` 可跳过对应步骤。
- `setup.cjs`：幂等；每次重新生成 `assets/`、两份清单与 `schema.sql`（全新空状态）。
- `build.cjs`：幂等；缺 `CLOUDBASE_ENV` 直接报错并给出可操作提示（除非显式传占位值）。
- `deploy.cjs`：先校验并**一次性列出**全部缺失的必填配置；要求输入环境 ID 二次确认（或 `--yes`）；`--dry-run` 只打印命令、不写 `cloudbaserc.json`、不碰云端；数据库初始化幂等不覆盖记录；注入函数环境变量后还原 `cloudbaserc.json`；健康检查后**如实区分**进程存活与完整功能。
- 已知限制：单用户；30 秒轮询消耗资源；默认域名首访可能有平台附件下载头；恢复历史无列表 UI；浏览器测试依赖本机浏览器。

## 9. 隐私清理、检查范围与版权素材处理（仅描述类别）

- **清理的个人/敏感类别**：云函数中的环境 ID、邮箱、UID；前端与脚本中的环境 ID；数据库初始化状态（重置为空）；命中正式站点的测试与内部发布报告（未纳入公开版本）；真实题库与书扫图片（全部剔除）。
- **版权素材处理**：真题、出版物书扫图片、解析等**无法确认再分发权限**的素材**一律排除**；保留导入能力（`private/` + `setup.cjs` 清单管线）并提供**虚构示例**（`make-demo-bank.cjs`，`mode:"demo"`，题目均标注「示例/虚构」，配图为程序生成的正弦曲线）。
- **检查范围**：源码、脚本、测试、构建产物（`index.js`、`vendor/cloudbase.js`、`sw.js`、两份清单）、`schema.sql`、待提交文件清单与 git 历史。检查时不打印敏感值，只记录类别、位置与处理结果。
- **第三方组件**：保留各自 LICENSE（`public/vendor/*-LICENSE`），在 `NOTICE.md` 列明来源与许可。

## 10. 测试结果与未验证部分

- **已验证（本地隔离环境，实际运行）**：`npm ci`；`install.cjs` 全流程；`npm test` 19 项全过；`test:browser`、`test:banks-browser`、`test:compat` 三套浏览器测试用本机 Edge 全过（示例题库渲染、图片放大、离线保存与刷新、双分区笔记隔离、跨设备、降级兼容）；`deploy.cjs --dry-run` 与缺配置报错路径；构建产物与待提交文件经扫描**不含**个人标识/密钥/版权素材。
- **未验证（无授权测试云环境，未实际运行）**：真实 CloudBase 环境创建、`tcb login`、`db execute` 初始化、`fn deploy`/`hosting deploy`、线上邮箱登录与端到端云同步、自定义域名/备案。`tcb` 命令参数依据本机 CLI 3.8.2 `--help` 核对，但**云端流程未跑通即不视为已验证**。部署者首次上线须按 `docs/DEPLOYMENT.md` 第 7 节手动验证。

## 11. 已知问题、技术债与建议后续

- 结构性 ID 命名空间 `lilin880:`/`cxyonly:` 与「分册/真题」语义耦合；若要做成通用多题库模板，建议把命名空间与分区标签抽象为配置（涉及 `core.js`/`engine.cjs`/`storage.js`/`app.js`/`index.html` 的正则与标签）。
- `deploy.cjs` 的云端命令未经真实环境验证；建议有测试环境后补一次端到端冒烟，并把健康检查扩展为「带鉴权的 preview/sync」探针（当前 health 不触库）。
- 恢复历史（`restores`）无列表/回滚 UI，仅靠本地 JSON 备份；可补一个历史快照界面。
- 浏览器测试依赖本机 Edge/Chrome 与 `serve.cjs`；可加一个 orchestrate 脚本统一拉起服务再跑测试，便于 CI（需安装 Playwright 浏览器）。
- 30 秒轮询可改为更长间隔或事件驱动以降资源消耗。

## 12. 仓库与版本标识

- GitHub 仓库地址：`https://github.com/WJQ123321-ops/math2-practice`（PUBLIC）。
- 版本标识：git 标签 **`v1.0.0`**（对应本次开源整理的可发布快照）。请以标签指代该范围，避免使用「本报告所在提交哈希」这类自引用标识。
- 对应范围：包含上述全部改动、示例题库生成器、文档与脚本；**不含**任何真实题库、书扫图片、个人记录或作者环境信息。
