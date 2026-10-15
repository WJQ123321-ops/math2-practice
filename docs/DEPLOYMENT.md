# 部署到自己的 CloudBase 环境

本项目沿用 Node.js 20 Event Function + PostgreSQL 私有 schema + 静态托管的现有架构。每个环境一个登记用户，不支持多人共享账号空间。以下是仓库脚本的使用说明；控制台权限、套餐和当前区域支持情况以自己的环境为准。

## 1. 云端准备

在腾讯云 CloudBase 国内站创建或选定自己的完整环境 ID，记录地域；开通 PostgreSQL 和静态网站托管。不要套用作者环境或其他人的 UID。

在身份认证中开启邮箱验证码登录并准备可投递的邮件配置，在用户管理中登记自己的邮箱并获取 UID。前端 `shouldCreateUser:false` 不会自动注册新用户。将网站访问域名加入认证安全域名，确保登录用户可调用 `math2-api` 函数；服务端仍会验证会话以及登记的 UID/邮箱。不要把数据库 schema 对匿名或普通 authenticated 角色放开。

静态托管默认域名可能有平台访问限制、到期限制或附件下载头；部署后需要实际打开检查。自定义域名按所在区域与平台要求配置，不承诺任何账号都可永久免费使用默认域名。

## 2. 配置与本地验证

安装 Node.js >=20.19，然后 `npm ci`。复制 `.env.example` 为 `.env`（PowerShell：`Copy-Item .env.example .env`）：

```ini
CLOUDBASE_ENV=自己的完整环境ID
CLOUDBASE_REGION=ap-shanghai
MATH2_ENV_ID=与上面相同的环境ID
MATH2_ALLOWED_UID=自己的认证用户UID
MATH2_ALLOWED_EMAIL=自己的邮箱
MATH2_REGION=ap-shanghai
```

构建环境与后端环境必须一致。邮箱和 UID 只写入云函数环境变量；前端只含公开环境 ID。CLI 复用 `npx tcb login` 登录态，Event Function 使用运行时注入的临时凭据。不在源码或聊天粘贴密钥。

```sh
npm run install:local
npm run serve:mock
```

先用虚构示例在本地验收，导入材料见 [IMPORTING.md](IMPORTING.md)。已导入正式题库时安装器不覆盖它。模拟服务会修改本地模拟学习记录；不等于真实云端同步。

## 3. 部署顺序

```sh
npx tcb login
npm run deploy -- --dry-run
npm run deploy
```

部署器会要求输入目标环境 ID。已经明确授权的自动化可用 `--yes`。`--dry-run` 只打印步骤，不调用云端写接口。

1. `setup` 校验题库、打包引用的图片，生成 v3/v2/legacy 资源清单、私有目标范围历史及完整 `schema.sql`。
2. `build` 构建 SDK、函数和带资源摘要的 Service Worker。
3. `practice-migration.cjs` 将 SQL 组织成单条事务执行块，再提交到显式环境。建立 state/restores、practice_meta/practice_buckets/practice_receipts/practice_restores，以及原子恢复函数。首次插入空状态，已有数据不覆盖。
4. 将自己的身份配置临时注入 cloudbaserc，部署 `math2-api`，随后还原本地配置文件。
5. 上传 **public/**；再调用函数 health。

如需单独检查迁移：

```sh
node scripts/practice-migration.cjs --schema math2_private --dry-run
# 已授权后才执行下面命令；替换环境ID
node scripts/practice-migration.cjs --schema math2_private --execute --allow-production --env YOUR_ENV_ID
```

生成 SQL 在被 Git 忽略的 `work/`。不要用旧版仅包含 state/restores 的 schema 初始化新版后端。迁移文件使用固定 schema 白名单；测试环境也应与生产环境分开。

`cloudbaserc.json` 使用 Nodejs20.19 Event Function、index.main、256MB、30秒。函数源码由 esbuild 打包；资源随函数部署，只有通过身份校验才下发。静态目录不得包含 private/、题库图片或配置文件。

## 4. 必须实际验收

- 打开站点检查登录、刷新、公式、图片和布局；页面不能被当附件下载。
- 未登录请求题库应拒绝；其他账号不能拿到题目或记录。
- 登记账号保存笔记、收藏、每日完成和目标，等待“已同步”。
- 在第二个隔离浏览器中登录，确认数据存在。仅刷新原浏览器不足以证明云端成功，因为 IndexedDB 也能保存。
- 等待“可离线使用”，断网重开并修改笔记；联网后检查补传。
- 导出备份并核对文件。在隔离环境验证恢复，不能拿正式学习记录随意做破坏性验收。

health 仅证明进程存活，不代表 PostgreSQL 可用。遇到 `CONFIG_MISSING` 检查函数配置，`ACCESS_DENIED` 检查 UID/邮箱，`PRACTICE_UNAVAILABLE` 检查完整迁移是否成功。云函数日志只保留错误码，不打印 token 或 SQL 内容。

## 5. 升级、备份与回退

升级前在网站导出全部学习记录，另行保存 private/ 与函数的 goal-bank-history.json。拉取代码，重新 setup/build，按数据库→函数→前端的顺序发布。看到“新版本已下载，点击切换”后，先保存笔记再切换；不要清除 IndexedDB。

保留上一版源码与部署包。代码回退不能撤销已恢复或修改的学习数据；跨协议回退应先在隔离环境验证。题库回退见导入指南；学习记录通过网站恢复流程核对。删除环境、数据库或历史备份必须明确确认，不能当作修复登录或同步问题的办法。
