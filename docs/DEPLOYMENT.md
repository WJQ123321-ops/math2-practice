# 部署教程（DEPLOYMENT）

本教程把「数二练习本」部署到**你自己的**腾讯云 CloudBase 环境。每个环境只服务一个登记账号（单用户架构）。

> **验证状态说明**：本文中的**本地命令**（`npm ci`、`demo-bank`、`setup`、`build`、`test`、`install.cjs`、`deploy.cjs --dry-run`）已在隔离环境实际跑通。`tcb` 命令的参数依据本机 **CloudBase CLI 3.8.2** 的 `--help` 核对。**涉及真实云端的步骤（创建环境、登录、初始化数据库、部署函数/托管、线上登录）未在本次开源整理中实际执行**（无授权的测试云环境），按「未验证」对待；控制台文案可能随版本变化，请以腾讯云官方文档为准。

---

## 0. 前置条件

- 一个**腾讯云账号**（需实名；CloudBase 按量计费可能产生费用）。
- 本机 **Node.js ≥ 20.19** 与 npm。
- 可选：本机 **Microsoft Edge 或 Chrome**（运行浏览器测试用）。
- 一套**你拥有合法权限**的题库（或先用自带虚构示例题库体验）。

支持的操作系统：Windows / macOS / Linux（脚本为 Node.js，跨平台；`tcb` 登录会拉起浏览器）。

---

## 1. 创建 CloudBase 环境

1. 登录腾讯云控制台，进入 **云开发 CloudBase**。
2. 新建环境：选择**按量计费**（或你接受的套餐），地域建议**上海（ap-shanghai）**。
3. 记录：
   - **环境 ID**（形如 `xxxx-xxxxxxxxx`）→ 填入 `CLOUDBASE_ENV` 与 `MATH2_ENV_ID`。
   - **地域** → 填入 `CLOUDBASE_REGION` / `MATH2_REGION`。
4. 进入环境的 **PostgreSQL（数据库）**，确认已开通（本项目用私有 schema `math2_private`）。

> 域名/HTTPS/备案：CloudBase 静态托管提供**默认 HTTPS 域名**（`*.tcloudbaseapp.com`），无需备案即可访问，适合个人使用。若你要绑定**自定义域名**，则该域名需**ICP 备案**（中国大陆地域），并在控制台「自定义域名」配置 CNAME 与证书。本项目不要求自定义域名。

---

## 2. 开启邮箱登录并登记你的账号

云函数用「固定 UID + 邮箱」二次校验，只放行你登记的账号，因此需要先有一个 CloudBase 身份认证用户：

1. 进入环境 **身份认证（Auth）→ 登录方式**，开启**邮箱验证码登录**。
2. 在 **用户管理** 中**创建用户**（用你常用的邮箱），或确认你的邮箱已注册。前端登录用 `shouldCreateUser:false`，**不会自动注册**，所以该邮箱必须已存在。
3. 记录该用户的 **UID**（用户详情页）→ 填入 `MATH2_ALLOWED_UID`；邮箱 → 填入 `MATH2_ALLOWED_EMAIL`。

---

## 3. 本地配置 `.env`

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

编辑 `.env`（该文件被 git 忽略，不会提交）：

```ini
CLOUDBASE_ENV=你的环境ID
CLOUDBASE_REGION=ap-shanghai
MATH2_ENV_ID=你的环境ID
MATH2_ALLOWED_UID=你的用户UID
MATH2_ALLOWED_EMAIL=你的邮箱
MATH2_REGION=ap-shanghai
```

**不要**把 `TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN` 写进 `.env`：云函数运行时由 CloudBase **自动注入**临时凭据；CLI 用 `tcb login` 的会话。密钥绝不进入 `.env`、前端或版本库。

---

## 4. 本地构建与自检

```bash
npm ci
node scripts/install.cjs        # 等价于 demo-bank(如需) -> setup -> build -> test
```

`install.cjs` 会：检查 Node 版本与依赖；若 `private/data/bank.json` 不存在则生成**虚构示例题库**（已导入真实题库则跳过，加 `--force-demo` 才覆盖）；生成受保护资源、清单与空 `schema.sql`；构建前端与云函数；运行 20 项 Node 测试。

单独执行：

```bash
npm run demo-bank   # 生成示例题库（仅示例；导入真实题库时跳过）
npm run setup       # private/ -> functions/math2-api/assets/ + 清单 + schema.sql
npm run build       # 构建 public/vendor/cloudbase.js、functions/.../index.js、public/sw.js
npm test            # Node 测试
```

本地静态预览（不含云同步）：`npm run serve` → http://127.0.0.1:8787 。

---

## 5. 登录 CloudBase CLI

```bash
npx tcb login
```

会拉起浏览器完成腾讯云授权。登录态保存在本机（`@cloudbase/cli`），后续命令复用。

---

## 6. 部署

先**预演**（不改动云端，打印将执行的命令）：

```bash
node scripts/deploy.cjs --dry-run
```

确认无误后**实际部署**：

```bash
node scripts/deploy.cjs
```

脚本会要求你**输入环境 ID 二次确认**（或加 `--yes` 跳过交互）。它依次执行：

1. **构建产物**（如未 `--skip-build`）。
2. **初始化数据库**：`tcb db execute -e <env> --sql "<schema.sql>"`。`schema.sql` 用 `CREATE ... IF NOT EXISTS` 与 `INSERT ... ON CONFLICT DO NOTHING`，**幂等**：重复部署不会清空或覆盖已有记录。
3. **部署云函数**：`tcb -e <env> fn deploy math2-api --force --install-dependency false`。部署前脚本会**临时**把 `envId` 与函数环境变量（`MATH2_ENV_ID/UID/EMAIL/REGION`）写入 `cloudbaserc.json`，部署后**立即还原**，因此凭据不会留在版本库。
4. **部署静态托管**：`tcb -e <env> hosting deploy public`（只上传 `public/`，题库/图片不进入静态托管）。
5. **健康检查**：`tcb -e <env> fn invoke math2-api -d '{"action":"health"}'`。

等价的纯手工命令（如你不用脚本）：

```bash
node scripts/sql.cjs schema.sql
npx tcb -e <env> fn deploy math2-api --force --install-dependency false
npx tcb -e <env> hosting deploy public
npx tcb -e <env> fn invoke math2-api -d '{"action":"health"}'
# 函数环境变量也可在控制台设置：云函数 -> math2-api -> 配置 -> 环境变量
#   MATH2_ENV_ID / MATH2_ALLOWED_UID / MATH2_ALLOWED_EMAIL / MATH2_REGION
```

---

## 7. 首次登录与最终验证

`health` 只证明**函数进程能响应**，**不代表**数据库可用或登录正常。请手动完成完整验证：

1. 打开静态托管**默认域名**（控制台 → 静态网站 → 访问地址）。
2. 用 `MATH2_ALLOWED_EMAIL` 登记的邮箱登录，收验证码。
3. 进入任意题目，写一条笔记，等待状态变为「已存本机」→「已同步」。
4. **刷新页面**，确认笔记仍在（说明云端读取成功）。
5. 切到另一分区/另一题，确认记录互不串扰。

若出现：
- `ACCESS_DENIED`：函数环境变量 `MATH2_ALLOWED_UID`/`MATH2_ALLOWED_EMAIL` 与登录账号不一致，或该邮箱未在身份认证中登记。
- `CONFIG_MISSING`：函数环境变量缺失，去控制台补齐 `MATH2_*`。
- 登录收不到验证码：检查身份认证是否开启邮箱登录、邮件是否进垃圾箱。
- 题库不显示/离线不可用：保持联网刷新，点击顶部「题库/离线状态」按钮触发更新。

---

## 题库 schema

`private/data/bank.json`（完整题库，v2 客户端）与 `private/data/legacy-bank.json`（旧客户端精简题库）结构：

```jsonc
{
  "schemaVersion": 1,
  "version": "your-bank-v1",
  "mode": "demo",                 // demo=示例；其它值视为正式题库（install 不会覆盖）
  "pending880": 0,
  "categories": [
    { "id": 900, "parent_id": null, "name": "高等数学", "display_order": 1024, "path": ["高等数学"] },
    { "id": "demo:vol01", "parent_id": null, "name": "分册", "display_order": 8192,
      "path": ["分册"], "bankId": "lilin880" }   // 第二分区分类需带 bankId:"lilin880"
  ],
  "questions": [ /* 见下 */ ]
}
```

题目 ID 必须匹配校验正则（`core.js`/`engine.cjs`/`storage.js` 共用）：

- 真题分区：`cxyonly:<数字>`，且 `year` 为 1900–2008 的整数。
- 分册分区：`lilin880:edition-<标识>:vol<数>:ch<数>:group<数>:(single_choice|fill_blank|essay):q<数>`，`bankId:"lilin880"`。

题目关键字段（示例见 `scripts/make-demo-bank.cjs`）：`type`（`single_choice`/`fill`/`essay`/`subjective`）、`document.stem_md`（Markdown，公式用 `$...$`/`$$...$$`，图片用 `![alt](images/xxx.png)`）、`document.options`、`document.answer`（选择题 `{option_ids:[...]}`，其它 `{reference_answer_md:"..."}`）、`document.explanation_md`、`document.asset_refs`、`categoryIds`、`classification:[{path,source}]`、`resources`（图片 ref→路径映射，供前端取 blob）、`contentHash`。图片放 `private/images/`，`resources` 的值须匹配 `^images/[a-zA-Z0-9_.-]+$`。

> 生成示例题库的脚本会计算 `contentHash=sha256({id,document})`。导入真实题库时保持同样字段即可；`setup.cjs` 据 `private/` 内容生成清单与 SHA256，无需手算。

---

## 运维

### 升级（保护已有记录）
1. 拉取新代码 → `npm ci`。
2. 如改了题库：更新 `private/`，`npm run setup`。
3. `npm run build` → `node scripts/deploy.cjs`。
   - 数据库初始化幂等，不会清空记录；前端更新题库时保留本机笔记与待同步队列；旧客户端仍获得 `legacy-bank.json`。

### 备份
- **学习记录**：应用内「备份与恢复 → 导出全部学习记录」下载 JSON（含笔记、收藏、错题、位置、待同步操作）。请定期导出。
- **云端恢复历史**：每次「恢复」会把旧快照归档到 `math2_private.restores`。
- **题库**：备份 `private/` 目录。

### 恢复
- 应用内「备份与恢复 → 选择备份文件 → 合并/替换」。整库替换需联网（走云端 `restore`，会归档旧状态并阻断旧队列回灌）。

### 卸载
1. 控制台删除云函数 `math2-api`、清空静态托管文件。
2. 删除数据库 schema：`tcb db execute -e <env> --sql "DROP SCHEMA IF EXISTS math2_private CASCADE"`（**会删除全部记录，请先导出备份**）。
3. 如不再需要，删除整个 CloudBase 环境。
4. 本地删除项目目录。

---

## 已知限制

- 单用户架构：一个环境只放行一个 UID/邮箱；**不适合多人共享**。
- 前台 30 秒轮询会消耗函数与数据库资源（按量计费环境注意用量）。
- 默认域名首次访问可能出现平台「页面访问提示」/附件下载头，属平台行为；绑定自定义域名（需备案）可改善。
- 恢复历史暂无列表 UI；用户侧恢复入口使用本地 JSON 备份。
- 浏览器测试依赖本机 Edge/Chrome；CI 无浏览器时跳过。
