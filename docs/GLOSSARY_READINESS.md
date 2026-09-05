# 专业术语库使用就绪评估

评估日期：2026-09-05。范围：数学、统计、量化金融、金融、经济、编程、科研论文七领域，以英文原文到中文学习译文为主。

## 当前判断

已达到项目内部“专业辅助翻译”门槛，可以用于课程学习、科研论文精读和知识库草稿；尚不能宣称满足免复核的高风险专业交付要求。当前证据包括词库结构与检索回归，以及七领域实际 Codex 推理评测，但不属于外部领域专家盲评。

| 用户用途 | 当前结论 | 仍需注意 |
|---|---|---|
| CQF / CFA / FRM 课程辅助学习 | 可使用，保留英文对照 | 听错术语、字幕断句、课程自定义缩写仍会影响译文 |
| 数学、统计与编程材料阅读 | 可作为辅助 | 公式中的变量、定理条件和代码语义仍需核对 |
| 科研论文精读及知识库长期保存 | 达到专业辅助使用门槛，重要结论复核后入库 | 自动门槛覆盖否定、条件和因果信号，但不证明整篇论证零错误 |
| 无人工复核的论文发表、专业报告或交易依据 | 不建议 | 缺外部专家盲评与真实端到端完整性证据 |
| 其他原文 / 目标语言 | 不在本轮验收范围 | 当前术语数据主要是英中对应，不代表多语言质量已验证 |

当前共有 1,424 个带领域词条、703 个别名。V7 静态门槛 192 项通过；220 项 Node 与 98 项 Python 回归通过。使用 Codex 套餐引擎的 140 条实际翻译评测中，术语为 422/423（99.76%），逻辑信号为 56/56，字幕对齐和受保护字面量完整率均为 100%。这些结果可以支持项目内部专业辅助使用结论，但不能据此宣称所有真实材料翻译准确率 100%。

完整方法和逐领域分母见 [实际专业翻译评估](PROFESSIONAL_TRANSLATION_EVALUATION.md)。

## V5 补充与概念核对

每领域新增 4 条，共 28 条；中文译法与说明由项目独立整理，不宣称是以下机构的官方中译。

- 数学：前向误差、后向误差、后向稳定性、适定问题。区分算法稳定性与问题条件性，保留适用条件。[Cornell 数值计算](https://www.cs.cornell.edu/courses/cs6210/2025fa/lec/2025-08-27.html)、[适定问题课程讲义](https://mathtube.org/sites/default/files/lecture-notes/Lamoureux_Michael.pdf)。
- 统计：族错误率、Holm 校正、Benjamini–Hochberg 程序、实际意义。说明 FWER 与 FDR 不同，以及 BH 的依赖条件；显著不等于实际重要。[R 多重检验文档](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html)。
- 量化金融：风险因子合格性检验、损益归因检验、假设损益、风险理论损益。区分风险模型损益口径与投资业绩归因。[BIS 市场风险术语](https://www.bis.org/committees/bcbs/basel-framework/standard/mar/10/inforce/2023-01-01/published/2020-03-27)、[BIS 模型要求](https://www.bis.org/basel_framework/chapter/MAR/31.htm?inforce=20230101&published=20200605&tldate=20150729)。
- 金融：摊余成本、实际利率法、FVTPL、SPPI。防止将 effective interest 与扣除通胀的 real interest 混同，或将 SPPI 单独当作计量分类的充分条件。[IFRS 9](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/)、[实际利率法说明](https://www.ifrs.org/news-and-events/updates/ifric/2018/ifric-update-march-2018/)。
- 经济：冲销式干预、卢卡斯批判、采购经理指数、经济滞后效应。注明 PMI 并非产出增长率；冲销不等于消除所有经济影响。[IMF 冲销操作](https://www.imf.org/EXTERNAL/PUBS/FT/ISSUES7/INDEX.HTM)、[IMF 政策制度与参数](https://www.elibrary.imf.org/view/journals/001/1991/110/article-A001-en.xml)、[ISM PMI](https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/)、[IMF 滞后效应研究](https://www.elibrary.imf.org/view/journals/001/2020/073/article-A001-en.xml)。
- 编程：可哈希性、浅拷贝、深拷贝、引用透明性。区分引用共享、复制协议、相等与哈希约束。[Python 术语](https://docs.python.org/3/glossary.html)、[Python 复制协议](https://docs.python.org/3/library/copy.html)、[Haskell 语言说明](https://www.haskell.org/)。
- 科研论文：可重复验证性、计算可复现性、等效性检验、非劣效性检验。注明不同学科可能反用复现相关术语，且“不显著”不能证明“等效”。[NASEM 术语口径](https://www.nationalacademies.org/read/25303/chapter/3)、[statsmodels 等效性检验](https://www.statsmodels.org/stable/examples/notebooks/generated/stats_rankcompare.html)。

## V6 应用阅读增强

V6 又新增 36 条（原计划七领域各 5 条，测试发现并补入“梯度缩放”），针对实际课程、模型文档和论文中容易被过度概括的语句：

- 数学：莱维刻画定理、杜布–迈耶分解、温和解、强制性、弗雷歇导数；说明定理条件与不同解概念的正则性差异。
- 统计：保形预测、边际覆盖率、同时置信带、三明治估计量、剖面似然；强调边际覆盖不等于条件覆盖。[交换性之外的保形预测](https://arxiv.org/abs/2202.13415)。
- 量化金融：SVI 参数化、固定行权价、固定 Delta、方差互换、静态套利；避免把参数拟合误写成无套利证明。
- 金融：业务模式测试、FVOCI、经信用调整的实际利率、合同现金流、POCI；保留 IFRS 9 分类与计量条件。[IFRS 9 教育材料](https://www.ifrs.org/content/dam/ifrs/meetings/2016/september/wss/education-session/edu-ifrs9.pdf)、[IFRS 9 定义](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2022/issued/part-a/ifrs-9-financial-instruments.pdf?bypass=on)。
- 经济：即时预测、贝弗里奇曲线、期限溢价、中性实际利率、产出缺口不确定性；区分模型估计量与可直接观测变量。[美联储期限溢价](https://www.federalreserve.gov/data/three-factor-nominal-term-structure-model.htm)、[美联储 r* 口径](https://www.federalreserve.gov/monetarypolicy/files/FOMC20151013memo02.pdf)、[BLS 贝弗里奇曲线](https://www.bls.gov/charts/job-openings-and-labor-turnover/job-openings-unemployment-beveridge-curve.htm)。
- 编程：激活检查点、写时复制、数据类型提升、可复现构建、自动混合精度及梯度缩放；区分计算换内存、类型规则与数值稳定性。[PyTorch 激活检查点](https://pytorch.org/blog/activation-checkpointing-techniques/)、[PyTorch 自动混合精度](https://docs.pytorch.org/docs/stable/amp.html)、[NumPy 类型提升](https://numpy.org/neps/nep-0043-extensible-ufuncs.html)。
- 科研论文：研究者自由度、多宇宙分析、设定曲线分析、报告规范、可复现工作流；说明稳健性分析的选择范围仍需理论合理。[设定曲线方法](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2694998)。

这些资料用于核对概念边界，中文译法仍由项目独立维护，不代表来源机构对译法背书。

## 要达到外部认证或免复核的专业使用要求，还缺什么

以下是本项目建议的后续验收方案，不是已完成测试或行业统一认证标准：

1. 固定有授权的真实材料测试集：每领域至少 20 个真实段落，覆盖定义、推导、否定句、比较句、缩写、表格与代码说明；与项目编写的回归样本分开保存。记录出处、版本、授权范围和原文位置。
2. 由领域专家盲评实际 Codex 与 Kimi 输出；NLLB 只单独评价快译。记录模型、配置、上下文、词库版本、耗时及原始输出，不将不同引擎成绩混合。
3. 人工对照原文标注：术语正确数/出现数、完整翻译单元数/原文单元数、数字/公式/变量保持率、重大语义错误数、跨段一致性。关键错误包括否定反转、因果关系误写、定理条件遗漏、单位或数量级错误。
4. 建议首轮目标：术语准确率至少 98%，数字/公式/变量关键项保持率 100%，原文单元均有对应译文，关键语义错误为 0。须逐领域报告分子、分母和失败样本；总平均不应掩盖某领域失败。有限样本达标也不等于未来永不出错。
5. 视频另外验证：连续真实音频片段的识别漏词、说话覆盖、分段连续性及字幕时间戳同步。全文翻译与字幕同步是否合格，不能仅凭词库测试推断。
6. PDF 另外验证：双栏阅读顺序、公式与脚注、表格、图注、扫描 OCR。提取错误不能归因于术语库，也不能靠词条扩容消除。

目前已执行项目独立用例的真实 Codex 推理评测，但尚未执行外部专家盲评，因此状态为“内部专业辅助门槛已通过，免复核专业交付未认证”。

## 升级边界

- V11 迁移为已有非空浏览器词库补充缺失项，不覆盖个人译法或注释，不强制恢复用户清空的词库。
- 视频后端使用最新预置；浏览器自定义词条仍未自动同步到后端，这是已知缺口。
- 本轮不扩充 NLLB 的 28 词白名单，不增加其每段最多 4 处的保护上限。
- 等当前翻译任务结束后重新加载扩展、重启本地服务，使新词库和迁移生效。本轮已完成真实 Codex 批量评测；Kimi 与外部专家盲评仍需单独执行，不能把 Codex 成绩直接代表 Kimi。
