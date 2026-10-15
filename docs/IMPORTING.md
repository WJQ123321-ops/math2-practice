# 题库导入：给使用者和 AI Agent

不要求使用某一厂商的 AI。具有视觉/OCR 能力的 Agent 可以处理扫描件；纯文本 Agent 可以处理已提取的 Markdown/JSON。OCR 工具由使用者提供，仓库不内置付费模型调用。

## 从原始材料开始

1. 确认材料路径、使用权限和导入范围。保留原始 PDF/照片，工作材料放 `private/import-work/`，不要提交到 Git。
2. 选 3–5 道代表题，覆盖选择题、填空/解答题、公式与配图。按页码和原题号提取题干、全部条件、选项、答案、解析、分类。不要把答案混进题干。
3. 数学公式使用 `$...$` 或 `$$...$$`；JSON 中反斜线写成 `\\`。保留上下标、负号、积分上下限和矩阵。配图从原材料裁取，不凭题干重画。缺失答案、缺图或模糊符号记为 pending，不进入正式库。
4. 请使用者核对代表题的文字、公式、图和解答。随后按相同规则分批处理，另存 `review.json`，包含来源页码/题号、疑点、核对状态；不要伪称完成数学审核。
5. 用稳定来源键分配题号，记录映射。相同题号不得重复；跨来源疑似重复需比较内容，不能只凭题号判断。正式库必须是**完整快照**，增量批次要先与旧库合并。
6. 执行预检、导入、setup、build，重启本地模拟服务。在浏览器实际查看公式和图片，点击选项、答案、下一题，保存笔记，记录每日完成；验证刷新和旧记录仍在。小批量通过后再扩展全库。

## 目录与命令

导入包必须有 `private/data/bank.json` 与 `private/images/`（无图可为空）。不要把来源扫描文件直接当网页资源。

```sh
npm run import:bank -- /path/to/package/private/data/bank.json
npm run import:bank -- /path/to/package/private/data/bank.json --apply
npm run install:local -- --skip-demo
npm run serve:mock
```

Windows 路径可写 `"D:/我的题库/private/data/bank.json"`。预检不写文件；`--apply` 会备份旧 JSON 到 `private/backups/<时间>/bank.json`，检查通过后替换。旧图片保留，重名但内容不同的图片会被拒绝，请采用新文件名。脚本不写学习数据库，不自动部署。每次导入后重启模拟服务，线上则按部署指南更新。

`npm run validate:bank` 校验当前库；`node scripts/validate-bank.cjs <bank.json> <private根目录>` 校验外部库。校验仅证明结构与引用完整，不证明数学正确。

## 最小可用 JSON

下面是一道原创示例。首次导入可只用一个分区，不要求填满三个分区。

```json
{
  "schemaVersion": 1,
  "version": "my-bank-001",
  "mode": "accepted",
  "categories": [
    {"id": "my:derivative", "parent_id": null, "name": "导数", "bankId": "exam", "path": ["导数"], "display_order": 1}
  ],
  "questions": [
    {
      "id": "cxyonly:1000001",
      "bankId": "exam",
      "year": null,
      "papers": [],
      "type": "essay",
      "serial": 1,
      "source": "本人原创示例，第1题",
      "categoryIds": ["my:derivative"],
      "classification": [{"id": "my:derivative", "path": ["导数"], "source": "人工分类"}],
      "displayOptions": [],
      "resources": {},
      "resourceNotes": [],
      "document": {
        "stem_md": "求 $f(x)=x^2$ 的导数。",
        "options": [],
        "answer": {"reference_answer_md": "$f'(x)=2x$"},
        "explanation_md": "由幂函数求导公式可得。"
      }
    }
  ],
  "archivedQuestions": []
}
```

导入器自动生成内容摘要 `contentHash` 与题库版本。直接手工维护当前库时，也必须更新版本和内容摘要；优先使用导入器。

## 字段与分区规则

| 字段 | 规则 |
| --- | --- |
| `bankId` | `exam` 分类练习、`lilin880` 分册练习、`yanxuan` 精选练习；分类节点与所属题一致 |
| `id` | exam/yanxuan 共用全局唯一的 `cxyonly:<数字>`；分册为 `lilin880:edition-mybook:vol01:ch01:group01:essay:q001` |
| `type` | `single_choice`、`fill`（也接受 `fill_blank`）、`essay`；分册 ID 内填空题写 `fill_blank` |
| `document.options` | 选择题形如 `[{"id":"a","label":"A","content_md":"$1$"},{"id":"b","label":"B","content_md":"$2$"}]` |
| `document.answer` | 选择题 `{"option_ids":["b"]}`；其他题 `{"reference_answer_md":"..."}` |
| `displayOptions` | 选择题与 document.options 保持一致；非选择题为空数组 |
| `resources` | 将 Markdown 图片引用映射到 `images/文件名.png`；可用 PNG/JPEG/WebP/GIF；不接受外链和路径穿越 |
| 分册补充字段 | `chapterLabel`、`groupLabel`、`originalNumber`；章节分类使用 parent_id 树，建议提供完整 path |
| `source` | 文件名、页码、原题号；不要写敏感绝对路径；与学习内容一并保存在私有题库 |

这些 ID 前缀是历史兼容格式，**不是题目来源或授权声明**。不必使用作者的题目。不要自行改 ID 正则，否则旧记录、备份和每日目标会断开关联。更完整的三分区示例见 `scripts/make-demo-bank.cjs` 生成结果。

图片示例：题干写 `![几何图](figure-001)`，资源写 `{"figure-001":"images/figure-001.png"}`。解析和答案中的图片也要映射。避免含空格或中文的图片文件名。

## 更新、退役与恢复

保留原题 ID，修正内容时更新正文；不要把原 ID 分配给另一道题。退役题移至 `archivedQuestions`，保留原分类与图片。导入器会拒绝从正式库快照中直接漏掉旧题；示例库允许被自己的题库完整替换。

setup 会保存上一版目标范围摘要（不含题干）到被 Git 忽略的 `goal-bank-history.json`，以兼容尚未同步的旧目标。不要从其他人的部署复制该文件，也不要在升级时随意删除。

恢复导入前的题库：先保存当前文件和学习记录，将 `private/backups/<时间>/bank.json` 复制回 `private/data/bank.json`，再 setup/build；旧图片未被导入器删除。恢复题库不会回滚学习数据库。学习记录恢复请使用网站的备份恢复入口。
