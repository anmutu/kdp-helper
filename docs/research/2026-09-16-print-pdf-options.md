# KDP 儿童绘本：PDF 排版与印刷规格选项

访问日期：**2026-09-16**。仅研究生图完成后的平装绘本 PDF/封面环节；不评估故事生成、生图或 bibliogon 完整应用。以下三项都是开发组件，**没有一项是开箱即用的出版产品或完整 KDP 合规校验器**。核查方式：官方文档、源码和 GitHub API；未安装、未运行项目、未实测 KDP 上传。

## 结论

- **固定版式、整页插图优先 pdf-lib**：精确控制坐标与纸张尺寸；业务规则需自建，维护停滞风险需接受。
- **模板复用、图文混排优先 @react-pdf/renderer**：React 组件式排版、维护更活跃；同样需要独立 KDP 规则与印前检查。
- **kdp-cover-math 只推荐作尺寸算法参考**：贴题且 MIT，但存在不合法开本、缺少彩色类型及页数边界问题，不能原样作为权威规则依赖。

上述选择是基于下文能力与限制的工程判断，不代表获得 KDP 认证。

## 1. kdp-cover-math：优先核查，但有条件采用

[官方 README](https://github.com/alanherron/kdp-cover-math)；实际包名为 `@alankherron/kdp-cover-geometry`。纯函数 TypeScript，零运行时依赖、ESM/CJS/types；返回英寸制封面展开尺寸、书脊、出血、内页尺寸及安全区域数值。**不生成 PDF，不排版图片/字体，不读取或校验成品 PDF；仅平装，不支持精装。** [LICENSE](https://github.com/alanherron/kdp-cover-math/blob/main/LICENSE) 为 MIT；注意 README 的“no attribution required”不能替代 LICENSE 中保留版权及许可声明的要求。

已核对 [实现源码](https://github.com/alanherron/kdp-cover-math/blob/922c3fe53be4a8829183f9be16d4fd6a0c93fe5c/src/index.ts)：

1. **9.5×9.5 英寸不应作为 KDP 平装选项**：README 与源码都包含此值，但 [KDP Print Options](https://kdp.amazon.com/en_US/help/topic/G201834180) 明确自定义平装宽度上限 8.5 英寸。README 列四种开本，源码已有五种，也存在文档漂移。
2. **`PaperType` 仅 `white | cream`，README 明示黑白内页假设**。源码系数分别为每页 0.002252 / 0.0025 英寸。[官方封面文档](https://kdp.amazon.com/en_US/help/topic/G201953020) 区分 standard color 0.002252 与 premium color 0.002347：白纸系数虽恰与 standard color 相同，仍不能表达完整彩色规则，尤其不能直接用于 premium color 绘本。
3. **79 页不是可靠放行边界**：`spineSupportsText` 使用 `pageCount >= 79` 且书脊宽度 ≥0.06 英寸。[提交规范](https://kdp.amazon.com/en_US/help/topic/G201857950) 写“more than 79”；[封面文档](https://kdp.amazon.com/en_US/help/topic/G201953020) 同时出现至少 79 与大于 79，Cover Creator 为 80。建议以最终处理后的偶数页数、至少 80 页保守判断，并核对官方模板；不要把 0.06 英寸条件视为充分校验。
4. **不校验完整页数/纸张组合**：负页数被截为零，没有整数、最小页数、最大页数或偶数页归整校验；内侧 gutter 固定 0.375 英寸且函数不接收页数，而官方按页数分档。条码只给矩形大小，不负责完整位置校验。[源码](https://github.com/alanherron/kdp-cover-math/blob/922c3fe53be4a8829183f9be16d4fd6a0c93fe5c/src/index.ts) / [官方页数及边距](https://kdp.amazon.com/en_US/help/topic/G201857950)。

维护快照：[GitHub API](https://api.github.com/repos/alanherron/kdp-cover-math) 显示 2026-05-18 创建、2026-06-18 最近推送，未归档；[近期提交](https://github.com/alanherron/kdp-cover-math/commits/main/) 主要涉及发布流程。属于年轻小型项目，有测试文件不等于规则经过 KDP 验收。

## 2. 两款 PDF 库

| 项目                                                          | 授权与定位                                                                                                   | 可用印刷能力                                                                                                     | 必须自行补齐                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [pdf-lib](https://github.com/Hopding/pdf-lib)                 | [MIT](https://github.com/Hopding/pdf-lib/blob/master/LICENSE.md)；底层 JS PDF 创建/修改库，不是编辑器产品    | 自定义页面宽高；嵌入 PNG/JPEG、精确坐标缩放绘制；自定义字体通过 fontkit 嵌入；可读写 MediaBox、TrimBox、BleedBox | 文字流式布局、左右页出血方向、封面展开与书脊计算、图片有效 DPI、字体和透明度检查；设置 PDF boxes 不会自动延展图片或证明合规 |
| [@react-pdf/renderer](https://github.com/diegomura/react-pdf) | [MIT](https://github.com/diegomura/react-pdf/blob/master/LICENSE)；React PDF 渲染器，**不是**同名 PDF 阅读器 | `Page` 自定义尺寸；`View/Text/Image` 模板布局；注册自定义字体供 PDF 使用，官方支持 TTF/WOFF；浏览器和 Node 输出  | KDP 尺寸/书脊规则、出血画布和图片延展、固定页分页控制、印前预检；不是直接把网页 DOM/CSS 打印成 PDF                          |

能力来源：[pdf-lib 官方示例：图片和字体](https://pdf-lib.js.org/) / [PDFPage API：尺寸、绘制、页面 boxes](https://pdf-lib.js.org/docs/api/classes/pdfpage) / [React-pdf Page](https://react-pdf.org/docs/v4/components/page) / [Image](https://react-pdf.org/docs/v4/components/image) / [Fonts](https://react-pdf.org/fonts)。注册字体后仍应检查最终 PDF 的嵌入状态，不能仅依靠浏览器预览。

维护快照（GitHub API 的 UTC 日期，不以版本号作结论）：

- pdf-lib：[Releases](https://api.github.com/repos/Hopding/pdf-lib/releases?per_page=3) 最近正式发布为 **2021-11-06**；[仓库 API](https://api.github.com/repos/Hopding/pdf-lib) 最近推送 **2024-07-17**、未归档。判断：发布长期停滞，不宜宣称维护活跃。
- React-pdf：[Releases](https://api.github.com/repos/diegomura/react-pdf/releases?per_page=30) 的 renderer 在 **2026-08-27** 有正式发布；[仓库 API](https://api.github.com/repos/diegomura/react-pdf) 最近推送 **2026-09-11**、未归档。判断：仍活跃；仓库为多包项目，已区别 renderer 与 UI 等其他包发布。

## 3. KDP 必须单独把关的事项

- **出血区域 ≠ 可见裁切标记**。[Paperback Submission Guidelines](https://kdp.amazon.com/en_US/help/topic/G201857950) 的 File specifications 明确禁止 crop marks / trim marks；[封面排错](https://kdp.amazon.com/en_US/help/topic/G201834260) 也要求封面无 crop marks。若某工具的 `bleed_marks` 会画出 crop marks，应关闭标记，但保留实际出血尺寸和延展图像；导出“印刷 PDF”不等于 KDP 合规。
- **内页与封面分别输出**：内页是单页序列而非跨页拼版，满出血宽度加 0.125、高度加 0.25 英寸；封面是封底＋书脊＋封面的单页展开图。公式分别见 [提交规范](https://kdp.amazon.com/en_US/help/topic/G201857950) 与 [封面尺寸](https://kdp.amazon.com/en_US/help/topic/G201953020)。
- **短篇彩色绘本先确定印刷档位**：以 8.5×8.5 平装为例，standard color 最少 72 页，premium color 最少 24 页，因此 24/32 页不能直接选择 standard color。[官方规格表](https://kdp.amazon.com/en_US/help/topic/G201857950)。
- **印前检查不能省略**：成品尺寸/页数与封面模板一致、字体嵌入、图片按最终物理尺寸至少 300 DPI、透明对象/图层处理，以及无裁切标记。不要把这两款库视为自动色彩转换、PDF/X 认证或完整 preflight 工具；本次未验证这些能力。[文件要求](https://kdp.amazon.com/en_US/help/topic/G201857950) / [封面印前清单](https://kdp.amazon.com/en_US/help/topic/G201953020)。

建议流程：锁定 KDP 的开本、彩色档位与最终页数 → 用 [官方 Cover Calculator](https://kdp.amazon.com/cover-calculator) 生成尺寸基准 → 二选一 PDF 渲染库 → 独立印前检查 → KDP Print Previewer 与纸质校样。`kdp-cover-math` 仅作算法对照或经修正后的辅助，不作唯一事实源。此为建议，未在本次研究中实施。
