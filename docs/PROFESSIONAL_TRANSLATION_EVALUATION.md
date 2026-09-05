# Quant Scholar 实际专业翻译评估

评估日期：2026-09-05。

## 结论

使用已登录的 Codex 套餐引擎进行真实推理后，Quant Scholar 通过项目内部 **Professional Translation Gate v7**。测试覆盖数学、统计、量化金融、金融、经济、编程和科研论文七个领域，每领域 20 条，共 140 条独立编写的应用句。

| 指标 | 结果 | 门槛 |
|---|---:|---:|
| 专业术语准确率 | 422 / 423（99.76%） | 每领域不低于 95% |
| 否定、条件、因果等逻辑信号 | 56 / 56（100%） | 每领域不低于 95% |
| 字幕 ID 与条目对齐 | 100% | 100% |
| 公式、数字、代码等受保护字面量 | 100% | 100% |

各领域结果：

| 领域 | 术语 | 逻辑信号 | 领域准确率 |
|---|---:|---:|---:|
| 数学 | 53 / 53 | 8 / 8 | 100% |
| 统计 | 64 / 64 | 11 / 11 | 100% |
| 量化金融 | 74 / 74 | 3 / 3 | 100% |
| 金融 | 71 / 72 | 4 / 4 | 98.61% |
| 经济 | 48 / 48 | 11 / 11 | 100% |
| 编程 | 59 / 59 | 9 / 9 | 100% |
| 科研论文 | 53 / 53 | 10 / 10 | 100% |

## 实际运行配置

- 引擎：`codex_subscription`
- 模型：`gpt-5.6-sol`
- 常规翻译：中等推理
- 疑难复译：高等推理
- 复译触发：所选领域的严格术语缺失、合法义项不满足或歧义需要复核
- 高等复译批量：最多 5 个字幕单元，防止长 JSON 中出现 ID 或输出对齐漂移
- NLLB：未参与这次专业精译，也不作为 Codex 的翻译草稿

系统会先保护公式、数字、变量、代码和缩写并把标记—原文映射作为只读信息交给模型。常规中等推理完成后，程序对明确领域的相关术语执行检查；不合格单元进入高等复译，并再次检查 ID、标记和术语。

Kimi 走相同的原文、上下文、术语与字面量保护路径。由于 Kimi CLI 不提供与 Codex 相同的中等/高等推理开关，明确术语漏译时采用最多 5 条一组的纠偏复译，并再次校验；本报告的 140 条实测成绩只代表 Codex，不能直接当作 Kimi 成绩。

## 复现

先确保本地服务可以检测到 Codex 登录，然后运行：

```powershell
.venv\Scripts\python.exe scripts\evaluate-professional-translation.py --provider codex_subscription --per-domain 20 --compact
```

静态词库和完整回归：

```powershell
node scripts\build-domain-preset.mjs
node scripts\evaluate-glossary.mjs
node --test tests/*.test.mjs apps/browser-extension/research/tests/*.test.mjs apps/browser-extension/research/tests/*.test.cjs apps/browser-extension/learning/tests/*.test.js
.venv\Scripts\python.exe -m unittest discover -s tests -q
```

## 结论边界

这是项目自建、可重复运行的内部专业门槛，不是翻译协会、CQF、CFA Institute、GARP、大学或第三方专家认证。140 条测试句与开发逻辑分离，但仍是项目编写的基准，不属于双盲人工评审。自动检查擅长发现术语漏译、条件词丢失、分段错位和字面量损坏，不能证明每句话的文风、推导含义及跨页论证都完美。

因此，当前版本适合课程学习、科研论文辅助精读和知识库草稿。论文发表、交易决策、审计/合规材料及其他高风险交付仍应保留原文并由相应领域人员复核。音频 ASR 和 PDF OCR/版面提取属于独立误差源，不由本次翻译评测覆盖。
