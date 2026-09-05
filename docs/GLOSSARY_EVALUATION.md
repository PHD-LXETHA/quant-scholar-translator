# Quant Scholar 专业术语库评估

## 结论

当前词库通过 **Quant Scholar Professional Glossary Gate v1**：946 个带领域词条、325 个别名，45 个评估样本全部通过，得分 100/100。该结论表示词库满足本项目当前的自动化专业质量门槛，不等同于第三方认证，也不替代领域专家对整篇译文的复核。

## 验收范围

质量门槛同时检查：

1. 七个领域均达到最低词条覆盖量：通用学术、经济、金融、数学、编程、量化金融、统计。
2. 每个词条具备原词、目标译法、领域和语境说明；别名结构有效。
3. 核心课程语句能够检索到预期专业概念，包括宏观经济、公司金融、利率与信用衍生品、随机分析、数值方法、统计计量和 Python 数据工作流。
4. `return`、`power`、`CI`、`generator` 等跨领域同形词利用邻近概念消歧；证据不足时不向模型注入冲突译法。
5. `duration` 等通用词只有在独立金融语境成立时才注入专业义，避免把“视频时长”提示为“久期”。
6. 英文复数、常见缩写和拼写变体通过别名覆盖；检索使用词边界，避免在更长单词内部误命中。

评估样本位于 `tests/glossary-evaluation.json`，执行器位于 `scripts/evaluate-glossary.mjs`。运行：

```powershell
npm run build:glossary
npm run evaluate:glossary
npm run test:extension
python -m unittest discover -s tests
```

## 术语来源与整理原则

词库围绕项目实际用途整理，并用权威资料核对概念边界：CQF 课程结构用于确定量化金融主题范围；BIS Basel Framework 用于市场、信用和操作风险术语；IMF 术语资源用于宏观经济及国际收支表述；NIST 统计手册用于统计检验、回归和不确定性术语；Python 官方术语表用于语言与运行时概念。

- CQF program structure: <https://www.cqf.com/about-cqf/program-structure/cqf-qualification>
- BIS Basel Framework: <https://www.bis.org/baselframework/BaselFramework.pdf>
- IMF terminology: <https://www.imf.org/en/about/terminology>
- NIST quantitative techniques: <https://www.itl.nist.gov/div898/handbook/quantgal.htm>
- Python glossary: <https://docs.python.org/3/glossary.html>

词库不复制第三方词典全文；每条中文译法、语境提示和别名均作为项目数据维护。对同一英文词的合法多义项，保留带领域的多个条目，而不是用一个中文词机械覆盖全部上下文。

## 未覆盖风险

- Whisper 若先把人名、缩写或公式听错，翻译术语表无法完全恢复原意。
- 新论文、机构自定义缩写和课程特有命名仍可能不在预置内。
- 45 个样本是稳定的工程回归集，不足以代表所有真实文献与讲座。
- 译文质量还取决于段落完整性、前后文、模型能力和提示设置。

发布前应抽取真实 CQF 课程字幕、金融论文和统计论文做人工盲评，至少记录术语准确率、漏译率、公式/数字保持率和上下文一致性；人工样本不应反向写入同一自动测试集后再宣称独立验证。
