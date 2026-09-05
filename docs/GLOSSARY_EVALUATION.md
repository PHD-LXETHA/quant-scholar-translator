# Quant Scholar 专业术语库评估

## 结论

当前词库通过 **Quant Scholar Professional Translation Gate v7 (Applied Reading)**：1,424 个带领域词条、703 个别名，192 项静态检查全部通过，得分 100/100。另一次实际 Codex 套餐推理评测覆盖七领域 140 条应用句，取得术语 422/423（99.76%）、逻辑信号 56/56、字幕对齐与受保护字面量完整率 100%。该结论表示项目满足当前内部专业翻译门槛，不等同于第三方认证，也不替代领域专家对整篇译文的复核。

## 验收范围

质量门槛同时检查：

1. 七个领域均达到最低词条覆盖量：通用学术、经济、金融、数学、编程、量化金融、统计。
2. 每个词条具备原词、目标译法、领域和语境说明；别名结构有效。
3. 核心课程语句能够检索到预期专业概念，包括 CQF 六大模块和高级选修、CFA 职业伦理、GIPS、财报分析、权益与固收估值、另类投资、组合管理，以及 FRM 风险治理、市场风险、信用风险、操作韧性、流动性风险和模型风险。
4. `return`、`power`、`CI`、`generator` 等跨领域同形词利用邻近概念消歧；证据不足时不向模型注入冲突译法。
5. `duration` 等通用词只有在独立金融语境成立时才注入专业义，避免把“视频时长”提示为“久期”。
6. 英文复数、常见缩写和拼写变体通过别名覆盖；检索使用词边界，避免在更长单词内部误命中。
7. 同领域原词与别名冲突检测使用与检索一致的正规化规则，覆盖重音、弯撇号和连字符；不会把拼写变体误当成两个无冲突概念。
8. 多轮七领域正例同时在浏览器和 Python 后端执行，验证明确领域与自动领域两种路径；误触发反例也在两端执行。概念说明片段检查防止关键适用条件被误删；它不是语义正确性的自动证明。
9. V7 的实际模型评估用 `translate_cues` 走生产字幕精译路径：常规中等推理，严格术语缺失或歧义时进入最多 5 条一组的高等复译，再校验术语、逻辑信号、字幕 ID 和受保护字面量。

2026-09-05 回归：Node 220 项、Python 98 项通过；静态门槛 192 项无失败。另行执行了 140 条真实 Codex 模型推理，但仍未完成外部专家盲评。NLLB 真实本机推理测试独立记录于 [性能说明](NLLB_GLOSSARY.md)，本次专业翻译结果见 [实际专业翻译评估](PROFESSIONAL_TRANSLATION_EVALUATION.md)。

评估样本位于 `tests/glossary-evaluation.json`，执行器位于 `scripts/evaluate-glossary.mjs`。运行：

```powershell
npm run build:glossary
npm run evaluate:glossary
npm run test:extension
.venv\Scripts\python.exe -m unittest discover -s tests -q
.venv\Scripts\python.exe scripts\evaluate-professional-translation.py --provider codex_subscription --per-domain 20 --compact
```

## 术语来源与整理原则

词库围绕项目实际用途整理，并用权威资料核对概念边界：CQF 当前课程结构的六个模块与高级选修用于随机微积分、量化风险收益、权益外汇、机器学习、固定收益信用及计算金融范围；CFA Candidate Body of Knowledge、Level I topic outlines、Code and Standards 用于投资分析、组合管理、财报和伦理范围；GARP 2026 FRM Study Materials 与考试范围用于风险治理、市场、信用、操作韧性和流动性主题；BIS、IMF、NIST 与 Python 官方资料用于监管、宏观、统计和编程概念复核。具体中文译法和语境说明由本项目独立整理，不表示这些机构认可或认证本词库。

- CQF program structure: <https://www.cqf.com/about-cqf/program-structure/cqf-qualification>
- CQF Module 1 — Building Blocks of Quantitative Finance: <https://www.cqf.com/about-cqf/program-structure/cqf-qualification/module-1-building-blocks-finance>
- CQF Module 2 — Quantitative Risk & Return: <https://www.cqf.com/about-cqf/program-structure/cqf-qualification/module-2-quantitative-risk-return>
- CQF Module 3 — Equities & Currencies: <https://www.cqf.com/about-cqf/program-structure/cqf-qualification/module-3-equities-currencies>
- CQF Module 4 — Data Science & Machine Learning I: <https://www.cqf.com/about-cqf/program-structure/cqf-qualification/module-4-data-science-machine-learning-l>
- CQF Module 5 — Data Science & Machine Learning II: <https://www.cqf.com/about-cqf/program-structure/cqf-qualification/module-5-data-science-machine-learning-ll>
- CQF Module 6 — Fixed Income & Credit: <https://www.cqf.com/about-cqf/program-structure/cqf-qualification/module-6-fixed-income-and-credit>
- CQF advanced electives: <https://www.cqf.com/about-cqf/program-structure/cqf-qualification/advanced-electives>
- CFA Candidate Body of Knowledge: <https://www.cfainstitute.org/programs/cfa-program/candidate-resources/cbok>
- CFA Code and Standards: <https://www.cfainstitute.org/standards/professionals/code-ethics-standards>
- GARP FRM study materials: <https://www.garp.org/frm/study-materials>
- GARP FRM exam scope: <https://www.garp.org/frm>
- BIS Basel Framework: <https://www.bis.org/baselframework/BaselFramework.pdf>
- IMF terminology: <https://www.imf.org/en/about/terminology>
- NIST quantitative techniques: <https://www.itl.nist.gov/div898/handbook/quantgal.htm>
- Python glossary: <https://docs.python.org/3/glossary.html>
- BIS expected credit losses: <https://www.bis.org/publications/new-era-expected-credit-loss-provisioning>
- Stan posterior predictive checks: <https://mc-stan.org/docs/stan-users-guide/posterior-predictive-checks.html>
- Stan effective sample size: <https://mc-stan.org/docs/reference-manual/analysis.html>
- Double/debiased machine learning: <https://www.nber.org/papers/w23564>
- Deflated Sharpe ratio: <https://doi.org/10.2139/ssrn.2460551>
- Parallel trends and pre-testing: <https://www.nber.org/papers/w24857>
- Difference-in-differences with staggered adoption: <https://www.nber.org/papers/w24963>
- Floating-point numerical errors: <https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html>
- PyTorch gradient clipping: <https://docs.pytorch.org/docs/main/generated/torch.nn.utils.clip_grad_norm_.html>

词库不复制第三方词典全文；每条中文译法、语境提示和别名均作为项目数据维护。对同一英文词的合法多义项，保留带领域的多个条目，而不是用一个中文词机械覆盖全部上下文。

## 未覆盖风险

分用途结论、本轮新增概念的参考资料及独立实证方案见 [使用就绪评估](GLOSSARY_READINESS.md)。

- Whisper 若先把人名、缩写或公式听错，翻译术语表无法完全恢复原意。
- 新论文、机构自定义缩写和课程特有命名仍可能不在预置内。
- 192 项静态检查构成工程回归集，不足以代表所有真实文献与讲座；100 分衡量词库结构和检索，不是模型翻译准确率。
- 译文质量还取决于段落完整性、前后文、模型能力和提示设置。

用于无需人工复核的高风险交付前，仍应抽取有授权的真实 CQF 课程字幕、金融论文和统计论文做领域专家盲评，至少记录术语准确率、漏译率、公式/数字保持率和上下文一致性；人工样本不应反向写入同一自动测试集后再宣称独立验证。
