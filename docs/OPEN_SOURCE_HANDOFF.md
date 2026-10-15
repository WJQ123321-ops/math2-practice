# 开源版维护交接（2026-10-15）

本次将现站后续功能同步到开源模板：每日练习与目标、热力图、分桶同步、备份核对恢复、第三题库分区、历史题与触控草稿板。保留各部署者自己的环境变量配置。

## 与作者站点的差异

- 只有虚构示例；没有作者题库、图片、个人记录和账号绑定。
- 分区显示为“分类练习 / 分册练习 / 精选练习”，保留历史内部 ID 以兼容记录协议。
- 作者专用排除题号列表为空。使用者通过 archivedQuestions 管理自己的退役题。
- goal-bank-history.json 由本地 setup 维护，Git 忽略；不能提交作者的历史题库范围。
- setup 生成完整每日记录 schema，覆盖旧安装器漏建表的问题；导入器提供预检、备份和旧题保护。

## 维护入口

入口逻辑在 public/app.js，账号/同步在 public/cloud.js；服务端 handler.cjs 负责鉴权及数据库协调，engine.cjs 负责记录合并，practice.cjs / practice-store.cjs 负责每日记录。数据库定义以 scripts/schema-template.sql 为准，Service Worker 以 scripts/sw-template.js 为准。生成文件不要直接改。

源码更新后：npm run setup、npm run build、相关测试、浏览器实际交互；需要发布云端时再按部署指南执行。仓库发布不等于已更新任何人的 CloudBase 环境。

测试使用明确标注的虚构 fixture，不依赖作者真题。认证测试验证实际打包资源；导入测试验证重复 ID、分类循环、缺图、答案引用、只读预检、导入备份和退役题保护。不要将本地模拟测试称为真实云数据库验证。
