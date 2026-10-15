# 数二练习本 · 自己的做题网站

离线优先的个人数学练习网站。每个人可以部署一份，导入自己的题目，独立保存笔记、错题和每日进度。

**开源的是网站程序，不是作者的题库。** 仓库只生成 11 道虚构示例题，真实题目、图片、账号配置和学习记录不在仓库里。程序采用 [MIT](LICENSE)，第三方组件见 [NOTICE.md](NOTICE.md)。

## 现在有哪些功能

- 分类练习、分册练习、精选练习三个分区；按章节、年份、题型和学习状态筛选。
- Markdown / LaTeX 题面与解析、图片放大、笔记、收藏、错题、学习状态和续练位置。
- 每日完成记录、每日目标、热力图；离线操作联网后同步。
- 草稿板：鼠标、触摸、触控笔书写、橡皮、撤销；草稿随切题清空，不作为长期笔记保存。
- PWA 离线缓存、升级提示、备份导出、冲突核对与恢复、历史题保留。

架构是 **一人一套 CloudBase 环境**，服务端按 UID + 邮箱只允许一个账号。不是公共多人注册服务；GitHub Pages 单独托管前端不能替代云函数与数据库。

## 十分钟本地体验

安装 Node.js 20.19 或以上版本，然后：

```sh
git clone https://github.com/WJQ123321-ops/math2-practice.git
cd math2-practice
npm ci
npm run install:local
npm run serve:mock
```

打开 <http://127.0.0.1:8788>。无需云账号，示例题可以做，笔记和每日记录可保存。本地模拟服务只监听本机，数据写入 `private/.local-preview-state.json`，**不提供真实登录或跨设备云同步**。重要学习记录请在应用里导出备份。模拟服务需要持续运行；停止后已完整缓存的页面仍可离线练习。

`install:local` 会生成示例、校验资源、构建和运行单元测试；遇到正式题库会保留它。单独运行 `npm run serve` 只启动静态外壳，不能替代模拟服务或云端。

## 让任意编程 AI Agent 帮你搭建

将这段话复制给能读写文件、运行命令的 Agent；没有预制题库包也能开始：

```text
请帮我搭建自己的做题网站，仓库是 https://github.com/WJQ123321-ops/math2-practice。
先 clone，阅读 AGENTS.md、README.md、docs/AGENT_DEPLOY.md 和 docs/IMPORTING.md。
先用虚构示例在本地跑通，并实际打开浏览器验证做题、笔记、每日完成和草稿板。
我的题目材料由我提供，可能是 PDF、照片、Markdown 或 JSON；没有材料时先完成示例体验。
请按导入指南提取题干、选项、答案、解析、分类和来源页码；保留原图和公式，
不确定或缺图的题放入待核对清单，不猜答案，不把识别结果直接视为已核对。
先整理少量代表题让我核对，再制作完整 bank.json，执行只读导入预检，
随后在我已授权的导入范围内使用 --apply、setup、build，并在浏览器验收。
部署使用我自己的 CloudBase 环境和账号，集中列出缺少的配置并指导我在本地填写。
不要把密钥、邮箱、UID、题目原文或学习记录提交到 GitHub。
我授权云端部署后，再预览命令并部署；如果本次已明确授权，不要重复索要授权。
最后给我网址、导入统计、备份方式，以及实际验证结果和仍未验证的部分。
```

## 导入自己的题目

完整流程与可复制格式见 **[题库导入指南](docs/IMPORTING.md)**。没有绑定任何 AI 厂商，不需要网站内配置模型 API Key。

Agent 将你有权使用的材料整理成一个完整快照：

```text
my-bank/private/
  data/bank.json
  images/figure-001.png
```

```sh
# 默认只检查，不写入
npm run import:bank -- /absolute/path/my-bank/private/data/bank.json
# 正式导入：备份旧 JSON，保留旧图片，再替换完整快照
npm run import:bank -- /absolute/path/my-bank/private/data/bank.json --apply
npm run setup
npm run build
npm run serve:mock
```

直接 `build` 前需要 `.env` 中的 `CLOUDBASE_ENV`；本地可填 `local-placeholder`。也可用 `npm run install:local -- --skip-demo` 完成 setup/build/测试。

导入器不负责 OCR 或判断数学答案正确性。重复题号、缺分类、分类循环、无效选项答案、图片越界或缺图会失败。更新已有正式题库时，快照不能漏掉旧题；退役题放入 `archivedQuestions`，保留正文、分类和图片，学习记录仍可关联。

## 部署与更新

见 [部署指南](docs/DEPLOYMENT.md) 和 [Agent 执行指南](docs/AGENT_DEPLOY.md)。需要自己的 CloudBase 环境、PostgreSQL、邮箱登录、登记用户 UID 和邮箱，以及函数调用权限与网站安全域名。第三方云服务可能收费。

```sh
# 先复制 .env.example 为 .env，填写自己的配置
npm run install:local
npx tcb login
npm run deploy -- --dry-run
npm run deploy
```

旧部署升级前先导出学习记录。新版部署顺序是 **完整数据库迁移 → 云函数 → public/**；只更新前端会缺少每日记录与恢复协议支持。迁移保留已有记录，生成空状态只用于首次建库。`private/` 仅作为受保护云函数资产部署，绝不上传到静态托管。

## 项目导航

| 目录 | 用途 |
| --- | --- |
| `public/` | 前端、公式渲染、离线缓存、草稿板 |
| `functions/math2-api/` | 账号校验、受保护题库、记录同步、每日记录与恢复 |
| `scripts/` | 示例生成、校验导入、资源打包、数据库迁移、构建、部署 |
| `private/` | 个人题库、图片、本地模拟数据和导入备份；Git 忽略 |
| `tests/` | 现有项目测试；运行前先 setup |
| `docs/` | 部署、导入、Agent 交接与更新说明 |

## 验证与限制

`npm test` 验证同步、恢复、鉴权、每日记录等逻辑；`npm run validate:bank` 检查题库结构。浏览器验收需实际检查公式和图片、三个分区、笔记保存、完成记录、目标、草稿板、备份与刷新。云端验收还需登记账号登录、第二个隔离浏览器读取同步结果、离线重开与更新。

函数 `health` 只说明进程存活，不能证明数据库正常。模拟服务和本地单元测试也不能证明真实云端部署成功。题目内容由导入者核对；本项目与考试机构、出版社或云服务商无隶属关系，不承诺内容正确或学习效果。
