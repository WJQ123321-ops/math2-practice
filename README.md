# 数二练习本（自托管 · 开源模板）

一个**单用户、自托管**的考研数学练习网站模板：离线优先的 PWA 前端 + 一个受保护的腾讯云 CloudBase 云函数。云函数负责鉴权、下发题库资源、同步与恢复学习记录。仓库自带一套**完全虚构的示例题库**，开箱即可跑通全部功能；正式上线前请导入你自己拥有合法权限的题库。

> 本项目是个人使用架构：**每位部署者使用自己的腾讯云环境**，每个环境只允许一个登记账号访问。它不是多人共享服务。

---

## 免责声明（请先阅读）

- 本项目是**非官方**的学习辅助工具，与考试主管部门、任何出版社、腾讯云及其它服务商**无隶属或背书关系**。
- 题目、解析以及任何 AI 生成内容（如有）**可能存在错误**，本项目**不承诺**考试成绩或学习效果。
- 仓库**仅包含虚构示例题目**，不包含任何真题、书扫图片或出版物内容。第三方内容（你自行导入的题目、图片、解析）的权利归**原权利人**所有；**使用者须自行确保拥有合法使用与再分发权限**。请勿假设任何出版题库可以再分发。
- 你导入的题库**只留在本地**：`private/`、`functions/math2-api/assets/`、`schema.sql`、`.env` 均被 git 忽略，**不会**也不会被 `git add -f` 提交。公开仓库中因此不含任何真实题目或书扫图片——**请不要**把这些目录加入版本库、不要关闭相关 ignore 规则、不要把题库内容贴进 Issue/PR/讨论。
- 部署者**自行管理**账号、数据安全、访问权限与备份。云函数仅允许 `.env` 中登记的单个 UID/邮箱访问，但数据安全最终由部署者负责。
- 腾讯云、模型接口、域名等第三方服务**可能收费**，费用由**部署者自行承担**。
- 本项目按 MIT 许可证「**按现状**」提供，不含任何明示或默示担保。详见 [`LICENSE`](LICENSE) 与 [`NOTICE.md`](NOTICE.md)。

免责声明**不能替代**权限控制、隐私清理与内容许可检查。

---

## 技术栈与结构

- **前端**：原生 ES Modules + PWA（Service Worker 离线缓存）+ IndexedDB（本地记录与待同步队列）。公式渲染 KaTeX，Markdown 渲染 marked，HTML 净化 DOMPurify（均见 `public/vendor/`）。
- **后端**：腾讯云 CloudBase 云函数 `functions/math2-api`（Node.js 20），用 esbuild 打包为单文件 `index.js`。题库与图片作为受保护资源随函数下发，**不进入静态托管**。
- **数据库**：CloudBase PostgreSQL，私有 schema `math2_private`（`state` 单例状态表 + `restores` 恢复历史表），对 `anon`/`authenticated` 关闭直接访问。
- **鉴权**：CloudBase 邮箱验证码登录；云函数再用固定 UID + 邮箱二次校验，只放行登记账号。

```
public/                 前端外壳、渲染库、PWA 资源（静态托管目录）
functions/math2-api/    云函数：handler.cjs(入口逻辑) engine.cjs(同步引擎) assets/(生成)
private/                题库与图片（git 忽略；示例题库由脚本生成，正式题库由你导入）
scripts/                demo-bank / setup / build / serve / sql / install / deploy
tests/                  Node 单元测试 + 可选浏览器测试
docs/                   部署、Agent 安装、维护交接文档
schema.sql              数据库结构（由 npm run setup 生成，空状态）
```

---

## 快速开始（本地）

前置：**Node.js ≥ 20.19**。本地流程不创建任何云资源、不联网部署。

```bash
npm ci                 # 安装依赖
npm run demo-bank      # 生成虚构示例题库（private/data + 一张示例配图）
npm run setup          # 生成受保护资源、清单与空数据库 schema.sql
npm run build          # 构建前端与云函数产物（需要 CLOUDBASE_ENV，见下）
npm test               # 运行 Node 测试套件（20 项）
npm run serve          # 本地静态预览 http://127.0.0.1:8787（不含云同步）
```

### 不部署先做题：本地模拟云端（`serve:mock`）

`npm run serve` 只是静态外壳，题库要登录云端才能取到。想在**不部署、不联网**的情况下直接刷题：

```bash
npm run serve:mock       # http://127.0.0.1:8788
```

它在本机起一个假的云接口：题库与图片直接读 `private/`，登录一律放行，同步状态写在 `private/.local-preview-state.json`（git 忽略）。**与真实部署的差别**：不连腾讯云、无真实登录、没有跨设备同步——笔记仍存在浏览器 IndexedDB 里，但**不会**备份到云端，重要记录请用「备份与恢复 → 导出」。仅用于本地试用，**不要**把它当线上环境。

一条命令完成上面 2–5 步：

```bash
node scripts/install.cjs
```

> `npm run build` 需要环境 ID。本地预览/测试可先在 `.env` 写一个占位值（如 `CLOUDBASE_ENV=local-placeholder`）；`install.cjs` 在未配置时会自动用占位值构建并给出警告。**云同步功能必须配置真实环境并部署后才可用。**

可选浏览器测试（需要本机 Microsoft Edge 或 Chrome，先完成 `demo-bank`+`setup`+`build`）：

```bash
npm run test:browser        # 单分区：离线、保存、图片放大、移动端布局
npm run test:banks-browser  # 双分区：笔记隔离、跨设备、章节遍历
npm run test:compat         # 兼容/降级：无 SW、无 CacheStorage、旧 API、IndexedDB 不可用
# 如用 Chrome：MATH2_BROWSER_CHANNEL=chrome npm run test:browser
```

---

## 部署到腾讯云（概要）

完整步骤见 **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**。概要：

1. 准备一个腾讯云账号并开通 CloudBase，创建一个**按量计费**环境，记下**环境 ID** 与**地域**。
2. 复制 `.env.example` 为 `.env`，填入环境 ID、你的登录**邮箱**和该账号的 **UID**。
3. `npm ci && node scripts/install.cjs`（本地构建与自检）。
4. `npx tcb login`（浏览器登录）。
5. `node scripts/deploy.cjs --dry-run` 预览将执行的云端命令；确认无误后 `node scripts/deploy.cjs` 实际部署（会创建/更新云资源并公开站点，脚本会要求你输入环境 ID 二次确认）。
6. 打开静态托管默认域名，用登记邮箱登录，写一条笔记并刷新验证同步。

> `deploy.cjs` 的健康检查只证明**云函数进程能响应**；**数据库可用与完整功能需你按上面第 6 步在浏览器手动验证**。脚本不会宣称「全部正常」。

让编程 Agent 帮你装？见 **[`docs/AGENT_DEPLOY.md`](docs/AGENT_DEPLOY.md)**，README 末尾也有可直接复制的指令。

---

## 配置项一览

| 名称 | 用途 | 必填 | 虚构示例 | 腾讯云控制台获取位置 | 是否敏感 | 配置位置 |
|---|---|---|---|---|---|---|
| `CLOUDBASE_ENV` | CloudBase 环境 ID，构建时注入前端、并被 `sql.cjs`/`deploy.cjs` 使用 | 是 | `your-env-id` | 云开发 → 环境 → 环境 ID | 否（公开标识符） | `.env`（前端构建 + 脚本） |
| `CLOUDBASE_REGION` | 环境地域 | 否（默认 `ap-shanghai`） | `ap-shanghai` | 云开发 → 环境详情 → 地域 | 否 | `.env`（前端构建 + 脚本） |
| `MATH2_ENV_ID` | 云函数运行时拼接鉴权网关地址用的环境 ID | 是 | `your-env-id` | 同 `CLOUDBASE_ENV` | 否 | **服务端**（云函数环境变量） |
| `MATH2_ALLOWED_UID` | 唯一允许访问的账号 UID | 是 | `1000000000000000001` | 身份认证/用户管理 → 用户 → UID | 是（个人标识） | **服务端**（云函数环境变量） |
| `MATH2_ALLOWED_EMAIL` | 唯一允许访问的账号邮箱（须与登录用户一致） | 是 | `you@example.com` | 身份认证/用户管理 → 用户 | 是（个人信息） | **服务端**（云函数环境变量） |
| `MATH2_REGION` | 云函数地域覆盖 | 否（默认 `ap-shanghai`） | `ap-shanghai` | 同地域 | 否 | **服务端**（云函数环境变量） |
| `TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN` | 云函数访问数据库的临时凭据 | **不要手填** | —— | 由 CloudBase 运行时**自动注入** | **是（密钥）** | 服务端自动注入；**严禁**写入 `.env`、前端或版本库 |

关于「网址/域名/参数」：

- **网站地址**：静态托管的默认域名（控制台 → 静态网站 → 访问地址）。这是部署**产出**，不是需要你填的变量。
- **后端 API 地址**：云函数鉴权网关 `https://<环境ID>.api.tcloudbasegateway.com`，由 `MATH2_ENV_ID` **自动推导**，无需单独配置。前端 `index.html` 的 CSP 已放行 `*.tcloudbasegateway.com` 等域名。
- **环境 ID / 地域**：即上表 `CLOUDBASE_ENV` / `CLOUDBASE_REGION`。
- 服务器密钥（SecretId/SecretKey）**绝不能进入浏览器代码**；前端只包含公开的环境 ID。

`.env` 已被 git 忽略；`.env.example` 是不含敏感值的模板。

---

## 导入你自己的题库

示例题库由 `scripts/make-demo-bank.cjs` 生成（`mode:"demo"`，全部虚构）。要换成你自己的内容：

1. 按相同 schema 准备 `private/data/bank.json`（完整题库，含两个分区）与 `private/data/legacy-bank.json`（旧客户端用的精简题库），图片放入 `private/images/`。题目结构、字段与 ID 规则见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#题库-schema) 与 `scripts/make-demo-bank.cjs`。
2. 重新运行 `npm run setup && npm run build`，再 `node scripts/deploy.cjs`。
3. `private/` 已被 git 忽略——**你导入的真实题库不会被提交**。请自行确认拥有再分发权限。

导入后先自检（本地，不碰云）：

```bash
npm test                 # Node 测试（含分区计数、图片资源存在性、鉴权，20 项）
npm run test:browser     # 浏览器：离线、保存、图片放大、移动端布局（需本机 Edge/Chrome）
npm run test:banks-browser  # 浏览器：双分区笔记隔离、跨设备、章节遍历（题库较大时耗时更长）
npm run serve            # 本地静态预览 http://127.0.0.1:8787（不含云同步）
npm run serve:mock       # 本地模拟云端预览 http://127.0.0.1:8788（可实际做题，见下）
```
```

> 题库规模会明显影响耗时：`setup` 需拷贝并重算全部资源哈希，`test:banks-browser` 会把整份题库灌进浏览器缓存。**945 题 / 1725 张图（约 58 MB）** 实测 `setup` 约 1 分钟、浏览器测试数分钟，属正常。

> ID 命名空间 `cxyonly:`（真题分区）与 `lilin880:`（分册分区）是**结构性标识**，被 `core.js`/`engine.cjs`/`storage.js` 的校验正则共用。保留它们可避免大范围改动；如需改名，须同步修改这些正则与 `index.html`/`app.js` 中的 `data-bank` 与标签。

---

## 升级、备份、恢复、卸载

见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) 的「运维」一节。要点：

- **升级默认保护已有记录**：`schema.sql` 用 `ON CONFLICT DO NOTHING` 初始化，重复部署不会清空数据库；前端更新题库时保留本机笔记与待同步队列。
- **备份**：应用内「备份与恢复 → 导出全部学习记录」下载 JSON；云端 `math2_private.restores` 保留恢复历史快照。
- **卸载**：删除云函数、清空静态托管、删除 `math2_private` schema 与环境即可；本地删除目录。

---

## 许可证

原始代码采用 **MIT**（见 [`LICENSE`](LICENSE)）。第三方组件各自遵循其许可证，详见 [`NOTICE.md`](NOTICE.md)（KaTeX/MIT、marked/MIT、DOMPurify/Apache-2.0 或 MPL-2.0、CloudBase SDK、esbuild、fake-indexeddb、playwright 等）。题库内容**不在** MIT 授权范围内。

---

## 给编程 Agent 的安装指令（可直接复制）

```
请帮我把这个「数二练习本」开源项目部署到我自己的腾讯云 CloudBase 环境。要求：
1. 先读 README.md 和 docs/DEPLOYMENT.md、docs/AGENT_DEPLOY.md，按文档检查 Node 版本与依赖（Node ≥ 20.19，否则 npm ci）。
2. 一次性列出所有还缺的必填配置（CLOUDBASE_ENV、MATH2_ENV_ID、MATH2_ALLOWED_UID、MATH2_ALLOWED_EMAIL 等），不要反复追问；指导我去腾讯云控制台哪里获取，不要让我把密钥粘贴到聊天里。UID/邮箱属个人信息，确认写入即可，不要回显。
3. 用本地 .env（git 忽略）保存配置。
4. 题库：如果我要用自己的题库，把 bank.json、legacy-bank.json 放进 private/data/、图片放进 private/images/，然后 npm run setup && npm run build。**private/ 必须保持 git 忽略，绝不提交、绝不贴进聊天/Issue**；没有自己的题库就 npm run demo-bank 生成虚构示例。
5. 本地自检：npm test（20 项）；有本机浏览器时 npm run test:browser / npm run test:banks-browser。题库较大（如近千题、上千张图）时这些步骤耗时更长，属正常。报告结果要如实，未跑的步骤不要说成已通过。
6. 在我明确授权后，再执行 npx tcb login 和 node scripts/deploy.cjs（先 --dry-run 给我看将执行什么）。部署会创建/更新云资源并公开站点、可能计费，动手前先跟我确认。
7. 部署后做健康检查，并明确区分「函数进程存活」「数据库可用」「完整功能」；最后给我访问地址和手动验证步骤，不要输出任何密钥。
8. 失败时定位原因、给出恢复或清理步骤，保护我已有的数据；任何删除前先让我导出备份。
9. 改动需要提交时：只提交代码/文档/测试，**先 git status 确认没有 private/、assets/、.env、schema.sql 等被忽略产物混入**；不要把题库内容写进提交信息或 PR 描述。
```
