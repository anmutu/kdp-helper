# 儿童绘本 → KDP：开源项目调研

调研日期：2026-09-16。

## 范围与结论

目标：通过现有 coderplan-ai 中转站生成插画，审核和排版后导出内页 PDF、封面文件，最终上架 KDP。当前仅做选型调研，没有安装、运行这些项目，没有调用付费模型，也没有验证任何候选的实物印刷结果。

本次检索覆盖 AI 绘本生成器、KDP 出版工作流、PDF/印刷规格工具；以下是与目标较贴近的候选，不是全网穷尽清单。判断依据为官方 GitHub README、关键源码、许可证及 KDP 官方帮助，而非营销文章。

初步建议：借鉴 StoryBloom 的内容生成与参考图流程、Bibliogon 的页面编辑和出版检查流程，将轻量 PDF 排版与 KDP 规则校验独立实现。不要直接照搬整个大型平台，也不要把仓库的“KDP-ready”描述当作通过 KDP 验收的证明。最终选型需用户确认并以样书验证。

## 1. StoryBloom：优先研究生成端

- 仓库：https://github.com/valleylmh/storybloom
- 许可证：MIT；以实际采用版本的 LICENSE 为准。
- 项目提供儿童故事与插画生成、多页阅读、人物一致性等流程，产品范围还包含账号和儿童成长相关功能，明显大于当前个人出版工具的需求。
- 源码的 CPA provider 接受 `CPA_BASE_URL`、`CPA_API_KEY` 和 `CPA_IMAGE_MODEL`，对 `gpt-image` 模型区分纯生成和带参考图编辑的请求构造。这比完全绑定某一家生图服务的项目更接近我们的接入需求。
- “可改接 coderplan-ai”是基于请求代码的工程推断，不是已通过联调的事实。仍需确认地址拼接、模型参数、实际输出像素、响应结构和错误处理。
- 未将其识别为现成的 KDP 印刷导出器；本次没有验证其能导出满足 KDP 尺寸、出血和封面要求的文件。
- 适合借鉴：分镜数据、参考图传递、生成失败处理、单页重新生成；不建议第一版引入账号、支付等无关模块。

一手来源：

- https://github.com/valleylmh/storybloom/blob/main/README.md
- https://github.com/valleylmh/storybloom/blob/main/LICENSE
- https://github.com/valleylmh/storybloom/blob/main/src/lib/image-generator.ts

## 2. Bibliogon：优先研究编辑端与出版流程

- 仓库：https://github.com/astrapi69/bibliogon
- 许可证：MIT；以实际采用版本的 LICENSE 为准。
- 项目包含绘本页面编辑、AI 插图、PDF 导出以及 KDP 出版向导等模块。
- 不是只有 README 描述：仓库存在绘本 PDF renderer、KDP cover validator、导出包实现和相关测试文件。本次仅检查代码存在与部分实现，没有运行测试。
- 绘本 PDF 使用 WeasyPrint；整个项目的后端、前端和插件范围较大，直接完整采用会引入超出个人小工具需求的复杂度。
- 关键限制：绘本 `styles.py` 的 `bleed_marks=True` 会设置 `bleed: 3mm; marks: crop`，源码同时说明背景延伸处理尚有后续工作。KDP 官方要求稿件不能包含裁切标记；因此该选项不能不加核验就作为 KDP 出血方案复用。默认不开启此选项不代表整个导出器一律不合规，本次结论仅针对该选项。
- 适合借鉴：缩略图选页、图文位置编辑、出版前检查清单、内页与封面分开导出。

一手来源：

- https://github.com/astrapi69/bibliogon/blob/develop/README.md
- https://github.com/astrapi69/bibliogon/blob/develop/LICENSE
- https://github.com/astrapi69/bibliogon/blob/develop/plugins/bibliogon-plugin-export/bibliogon_export/picture_book_pdf/__init__.py
- https://github.com/astrapi69/bibliogon/blob/develop/plugins/bibliogon-plugin-export/bibliogon_export/picture_book_pdf/styles.py
- https://github.com/astrapi69/bibliogon/tree/develop/plugins/bibliogon-plugin-kdp
- https://kdp.amazon.com/en_US/help/topic/G201857950

## 3. kdp-book：流程很接近，但暂不采用代码

- 仓库：https://github.com/ShonP/kdp-book
- README 描述了概念、正文、插画、KDP PDF/EPUB 的自动化流水线；源码树包含内页 PDF、封面几何和图片客户端模块。
- 使用 Python 和 Microsoft Agent Framework 等组件，与当前轻量个人工作台不一定匹配。
- GitHub API 的 license 字段为 null；本次检查的文件树未找到 LICENSE，pyproject.toml 未声明许可证。README 的 License 段写有“Private. © Shon Pazarker.”。因此不把它视为已明确授权可复用的开源组件，不复制其实现；如以后考虑使用，先取得明确授权。
- 可以参考公开描述的阶段划分，但不把“代码公开可见”与“许可复用”混为一谈。

一手来源：

- https://github.com/ShonP/kdp-book
- https://github.com/ShonP/kdp-book/blob/main/pyproject.toml
- https://api.github.com/repos/ShonP/kdp-book

## 4. PDF 与尺寸模块

补充调研见同目录 `2026-09-16-print-pdf-options.md`。该部分覆盖 `alanherron/kdp-cover-math` 与通用 PDF 库，区分可参考的计算逻辑、需要重新核对的 KDP 规则，以及需要我们实现的功能。

## 建议的第一版范围（待确认）

1. 输入主题、语言、年龄段，生成可编辑的页面清单。
2. 选画风或提供参考图，先生成 2–3 页样张，不立即批量生成整本。
3. 确认样张后批量调用 coderplan-ai；逐页保存结果，支持失败后恢复和单页重画。
4. 插画与文字分别排版，提供有限模板，不先做任意拖拽的设计软件。
5. 按选定印刷规格检查实际像素、边距、页数和页面尺寸，导出内页 PDF 与独立封面文件。
6. 初期人工完成 KDP 上传、预览和最终发布；不把自动登录/上架作为第一版依赖。

## 验证门槛

- 用一次受控生图调用确认 coderplan-ai 的实际兼容性，提前确认费用边界。
- 用少量样张确认统一画风是否足够，避免仅凭参考图参数承诺角色完全一致。
- 图片请求尺寸与返回尺寸都记录，最终按实际像素和印刷占用面积检查清晰度。
- KDP 规则以官方文档为准；开源项目的常量、预设和错误提示只能作为实现参考。
- 最终上传前通过 KDP Previewer 检查，并建议订购样书查看裁切、装订和颜色效果。
- 没有任何候选在本次调研中被端到端运行验证，本文不构成“直接可上架”的保证。

KDP 官方参考：

- https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6
- https://kdp.amazon.com/en_US/help/topic/G201857950
- https://kdp.amazon.com/en_US/help/topic/G200641240
