# Quant Scholar Translator 0.8.0

作者：**LX.COCOSCENT**（GitHub：**PHD-LXETHA**）

本版本为扫描版科研 PDF 增加完整的本地 OCR 精译流程。

- 没有文字层时，PDF 按钮自动变为“本地 OCR 并精译”。
- 使用 RapidOCR 3.x 与 ONNX Runtime 在本机逐页识别；扫描页图像不发送到第三方 OCR 服务。
- OCR 结果保留文字位置与置信度，并按论文阅读顺序重建段落、双栏和标题层级。
- OCR 完成后自动进入当前选择的 Codex/Kimi 专业精译，无需再次点击。
- OCR 与翻译共用进度面板，支持暂停、取消、失败提示以及已保存译文恢复。
- PDF 精译继续通过 Native Messaging 静默启动本地后端。

复杂数学公式、手写内容和低清晰度扫描件仍应对照原页复核。
