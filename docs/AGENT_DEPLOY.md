# Agent 部署指南（AGENT_DEPLOY）

本文件供**编程 Agent**（Claude/Codex/通义/任意具备 shell 与文件读写能力的助手）阅读，用来引导用户把本项目部署到**用户自己的**腾讯云 CloudBase 环境。不绑定任何特定模型或厂商。

## 总原则

- **单用户架构**：一个环境只服务一个登记账号。不要把它当多人服务部署。
- **不碰用户的正式环境**：除非用户明确给出环境 ID 并授权，绝不部署、改配置、写数据库或删资源。
- **密钥不进聊天**：优先用本地 `.env`（git 忽略）、已有的 `tcb login` 登录态，或让用户在控制台/终端交互输入。**不要要求用户把 SecretId/SecretKey/验证码粘贴到对话里**。
- **诚实报告**：区分「函数进程存活」「数据库可用」「完整功能验证」。`health` 通过 ≠ 全部正常。未实际跑过的云端流程不要说成已验证。
- **保护数据**：升级/初始化默认幂等，不覆盖已有记录；任何删除前先让用户导出备份。

## 步骤

### 1. 读文档、查环境
- 读 `README.md`、`docs/DEPLOYMENT.md`、本文件。
- 检查 Node 版本（需 ≥ 20.19）：`node -v`。检查依赖：`node_modules` 是否存在，否则 `npm ci`。
- 检查是否已有 `.env`。

### 2. 一次性列出缺失配置（不要反复追问）
读取 `.env.example`，对照 `.env`，**一次性**告诉用户还缺哪些必填项，以及每项去哪里拿：

| 变量 | 含义 | 控制台获取位置 |
|---|---|---|
| `CLOUDBASE_ENV` / `MATH2_ENV_ID` | CloudBase 环境 ID | 云开发 → 环境 → 环境 ID |
| `CLOUDBASE_REGION` / `MATH2_REGION` | 地域（默认 ap-shanghai） | 云开发 → 环境详情 |
| `MATH2_ALLOWED_UID` | 允许访问的账号 UID | 身份认证/用户管理 → 用户 → UID |
| `MATH2_ALLOWED_EMAIL` | 允许访问的邮箱 | 身份认证/用户管理 → 用户 |

提醒用户：还需在 **身份认证** 开启**邮箱验证码登录**，并**预先创建/确认**该邮箱用户（前端 `shouldCreateUser:false`，不会自动注册）。明确告知 `TENCENTCLOUD_SECRET*` **由运行时自动注入，不要手填**。

### 3. 写入本地配置
- 引导用户把上述值写入 `.env`（可由用户在本地编辑器填写，或在终端交互输入）。`.env` 已被 git 忽略。
- **不要**把真实 UID/邮箱回显到对话或日志；确认「已写入」即可。

### 4. 本地构建与自检（不碰云）
```bash
node scripts/install.cjs
```
预期：生成/复用题库 → setup → build → 19 项 Node 测试通过。失败则按报错定位（缺依赖→`npm ci`；缺 `CLOUDBASE_ENV`→build 会用占位值并警告；测试失败→看具体断言）。

### 5. 征得授权后再动云端
- 明确告知用户：部署会**创建/更新云资源**、**公开站点**、**可能计费**，并询问是否授权。
- 授权后：`npx tcb login`（拉起浏览器；若已登录会复用登录态）。
- 先 `node scripts/deploy.cjs --dry-run` 给用户看将执行的命令；确认后 `node scripts/deploy.cjs`（脚本会要求输入环境 ID 二次确认）。

### 6. 健康检查与最终验证
- 脚本末尾会调用 `health` 并打印结果。向用户**如实说明**：health 只代表函数进程存活。
- 给出静态托管默认域名，引导用户**手动**完成：登录 → 写笔记 → 刷新 → 确认记录仍在。
- 常见错误的处置见 `docs/DEPLOYMENT.md` 第 7 节（`ACCESS_DENIED`/`CONFIG_MISSING`/收不到验证码/题库不更新）。

### 7. 失败恢复与清理
- **函数部署失败**：看 `tcb` 输出与控制台函数日志；确认 `cloudbaserc.json` 已被脚本还原（不应残留凭据）。
- **数据库初始化失败**：确认环境已开通 PostgreSQL；`schema.sql` 幂等，可重试。
- **登录被拒**：核对函数环境变量 `MATH2_ALLOWED_UID/EMAIL` 与登录账号一致。
- **需要回滚**：重新部署上一个可用版本；数据库记录不会被 `deploy` 删除。任何 `DROP SCHEMA` 前必须让用户先导出备份。

### 8. 交付
- 给出：访问地址、健康检查结果、手动验证清单、后续维护方法（升级/备份/恢复/卸载见 `docs/DEPLOYMENT.md`）。
- **绝不输出**密钥、验证码、SecretKey；UID/邮箱如非必要也不回显。

## 可直接执行的命令速查

```bash
node -v                         # 需 >= 20.19
npm ci                          # 安装依赖
node scripts/install.cjs        # 本地构建 + 自检（不碰云）
npm run serve                   # 本地静态预览 http://127.0.0.1:8787
npx tcb login                   # 登录 CloudBase（需用户授权）
node scripts/deploy.cjs --dry-run   # 预演云端命令
node scripts/deploy.cjs         # 实际部署（需用户授权 + 输入环境 ID 确认）
```
