# 导出 JPEG 内嵌 ICC 配置文件的体积问题

记录日期：**2026-09-18**。状态：**问题已量化，修复未实施**——因为改动会影响导出色彩数据，必须在有印刷实样对比的前提下进行，不能只看屏幕。

## 现象

导出管线（`src/server/pdf.ts` 的 `imageFor()`）使用 sharp 的 `withIccProfile("cmyk")` 做 RGB→CMYK 转换。该调用会把一个完整的 CMYK ICC 配置文件嵌入**每一张**输出 JPEG，而 pdf-lib 将 JPEG 字节原样嵌入 PDF，因此每个"不同裁切参数的图片"都会携带一份配置文件。

实测（sharp 0.35.4，100×100 纯色测试图）：

| 管线                                 | 输出              | 大小    |
| ------------------------------------ | ----------------- | ------- |
| `withIccProfile("cmyk")`（当前实现） | 4 通道 CMYK + ICC | ~962 KB |
| `toColourspace("cmyk")`（无 ICC）    | 4 通道 CMYK       | ~346 B  |

即**每张唯一图片约引入 0.96 MB 的 ICC 负担**。一本 32 页、每页独立插画的绘本，仅 ICC 就使 PDF 膨胀约 30 MB（KDP 上限 650 MB，不构成失败，但显著拖慢上传与 Previewer 处理）。

## 为什么不直接改

两个候选方向都有未验证风险：

1. 改用 `toColourspace("cmyk")`（不嵌 ICC）：像素仍为 CMYK，但失去色彩上下文；KDP 会自行转换，实际色差方向未知。
2. 彩色书改输出 sRGB 不转 CMYK：社区与 KDP 论坛普遍推荐 sRGB（KDP 内部转换），与本工具"导出即所见"的声明冲突，需要实样验证。

## 建议的验证流程（实施前必做）

1. 用同一本样书导出三个版本：现状（CMYK+ICC）、CMYK 无 ICC、sRGB。
2. 上传 KDP 走 Print Previewer，并订购纸质样书对比色彩/灰度。
3. 依据实样选择方案后，更新 `imageFor()`、upload-notes 文案与 `docs/verification.md`，并补充 PDF 级回归（`pdfimages -list` 断言色彩空间与体积上限）。

在此之前，体积问题保持现状是正确取舍：正确性优先于文件大小。
