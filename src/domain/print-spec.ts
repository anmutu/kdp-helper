import {
  defaultColorStyle,
  defaultBlackWhiteStyle,
  newPage,
  printConfigSchema,
  type Asset,
  type Book,
  type Issue,
  type PageGeometry,
  type PrintConfig,
  type Rect,
} from "./book";

export const RULES = {
  version: "kdp-paperback-2026-09-17",
  checkedAt: "2026-09-17",
  dpi: 300,
  manuscriptUrl: "https://kdp.amazon.com/en_US/help/topic/G201857950",
  coverUrl: "https://kdp.amazon.com/en_US/help/topic/G201953020",
  calculatorUrl: "https://kdp.amazon.com/cover-calculator",
  printCostUrl: "https://kdp.amazon.com/en_US/help/topic/G201834340",
  printCostCheckedAt: "2026-09-18",
  trims: {
    "8.25x8.25": {
      label: "经典方形",
      width: 8.25,
      height: 8.25,
      premiumMax: 800,
      blackWhiteMax: 800,
      blackCreamMax: 750,
    },
    "8.5x8.5": {
      label: "方形绘本",
      width: 8.5,
      height: 8.5,
      premiumMax: 590,
      blackWhiteMax: 590,
      blackCreamMax: 550,
    },
    "8x10": {
      label: "经典竖版",
      width: 8,
      height: 10,
      premiumMax: 828,
      blackWhiteMax: 828,
      blackCreamMax: 776,
    },
    "8.5x11": {
      label: "大幅竖版",
      width: 8.5,
      height: 11,
      premiumMax: 590,
      blackWhiteMax: 590,
      blackCreamMax: 550,
    },
  },
} as const;

export function pageRange(config: PrintConfig) {
  if (config.ink === "standard") return { min: 72, max: 600 };
  if (config.ink === "black")
    return {
      min: 24,
      max:
        config.paper === "cream"
          ? RULES.trims[config.trim].blackCreamMax
          : RULES.trims[config.trim].blackWhiteMax,
    };
  return { min: 24, max: RULES.trims[config.trim].premiumMax };
}
export function inkLabel(ink: PrintConfig["ink"]) {
  return ink === "black" ? "黑白" : ink === "premium" ? "高级彩色" : "标准彩色";
}
export function paperLabel(paper: PrintConfig["paper"]) {
  return paper === "cream" ? "米色纸" : "白纸";
}
export function spineCoefficient(config: PrintConfig) {
  return config.ink === "premium"
    ? 0.002347
    : config.ink === "black" && config.paper === "cream"
      ? 0.0025
      : 0.002252;
}
export function specKey(config: PrintConfig) {
  return `${RULES.version}:${config.trim}:${config.ink}:${config.bleed}:${config.paper}`;
}
export function gutter(pageCount: number) {
  return pageCount <= 150
    ? 0.375
    : pageCount <= 300
      ? 0.5
      : pageCount <= 500
        ? 0.625
        : pageCount <= 700
          ? 0.75
          : 0.875;
}
export function pageGeometry(
  config: PrintConfig,
  pageCount: number,
  pageIndex: number,
  layout: "caption" | "full",
): PageGeometry {
  const trim = RULES.trims[config.trim];
  const bleed = config.bleed ? 9 : 0;
  const leftPage = pageIndex % 2 === 1;
  const width = trim.width * 72 + bleed,
    height = trim.height * 72 + bleed * 2;
  const trimRect = {
    x: leftPage ? bleed : 0,
    y: bleed,
    width: trim.width * 72,
    height: trim.height * 72,
  };
  const inner = Math.max(36, gutter(pageCount) * 72),
    outer = 36;
  const safe = {
    x: trimRect.x + (leftPage ? outer : inner),
    y: bleed + 36,
    width: trimRect.width - inner - outer,
    height: trimRect.height - 72,
  };
  const image =
    layout === "full"
      ? config.bleed
        ? { x: 0, y: 0, width, height }
        : { ...safe }
      : { ...safe, height: safe.height * 0.68 };
  const text = {
    x: safe.x,
    y: safe.y + safe.height * 0.73,
    width: safe.width,
    height: safe.height * 0.27,
  };
  return { width, height, trim: trimRect, safe, image, text };
}
export function coverGeometry(config: PrintConfig, pageCount: number) {
  const trim = RULES.trims[config.trim];
  const spine = pageCount * spineCoefficient(config) * 72;
  const width = trim.width * 144 + spine + 18,
    height = trim.height * 72 + 18;
  const frontX = 9 + trim.width * 72 + spine;
  const heading = {
    x: frontX + 36,
    y: 45,
    width: trim.width * 72 - 72,
    height: trim.height * 72 * 0.3,
  };
  const headingPanel = {
    x: heading.x - 12,
    y: heading.y - 12,
    width: heading.width + 24,
    height: heading.height + 24,
  };
  const backText = { x: 45, y: 45, width: trim.width * 72 - 72, height: trim.height * 72 - 180 };
  return {
    width,
    height,
    spine,
    heading,
    headingPanel,
    backText,
    front: { x: frontX, y: 9, width: trim.width * 72, height: trim.height * 72 },
    image: { x: frontX, y: 0, width: trim.width * 72 + 9, height },
    back: { x: 9, y: 9, width: trim.width * 72, height: trim.height * 72 },
    barcode: { x: 9 + trim.width * 72 - 162, y: height - 113.4, width: 144, height: 86.4 },
  };
}
export function pixelRequirements(rect: Rect) {
  return {
    width: Math.ceil((rect.width / 72) * RULES.dpi),
    height: Math.ceil((rect.height / 72) * RULES.dpi),
  };
}
export function sizeLabel(widthInches: number, heightInches: number) {
  return `${widthInches.toFixed(3)} × ${heightInches.toFixed(3)} in（${(widthInches * 25.4).toFixed(1)} × ${(heightInches * 25.4).toFixed(1)} mm）`;
}
export function aspectRatioLabel(rect: Rect) {
  return `≈ ${(rect.width / rect.height).toFixed(2)} : 1（宽 : 高）`;
}
// 正文文字颜色预设（需求 F08「预设范围内调整字号与颜色」）。
// 只提供深色调印刷安全色；键与 book.ts pageSchema 的 textColor 枚举必须一致
//（由 print-spec 测试断言）。hex 仅用于屏幕预览与 CMYK 换算。
export const TEXT_COLORS = {
  ink: { label: "墨黑", hex: "#111111" },
  sepia: { label: "深棕", hex: "#5b4636" },
  navy: { label: "藏蓝", hex: "#2c3e50" },
  slate: { label: "青灰", hex: "#4a5560" },
  warmgray: { label: "暖灰", hex: "#5f5a52" },
} as const;
export type TextColorKey = keyof typeof TEXT_COLORS;
// 美区（amazon.com）大尺寸平装单册印刷成本，公式：固定成本 + 页数 × 每页成本。
// 来源：RULES.printCostUrl，核对日期见 printCostCheckedAt。本工具四种开本
// 宽度均大于 6.12 英寸，全部落在官方 Large trim 档位；页数边界按官方表
// 「24–110 为固定成本」处理为 ≤110 固定、>110 按页计费（高级彩 ≤40 固定）。
export function printingCostEstimate(config: PrintConfig, pageCount: number) {
  if (config.ink === "black") return pageCount <= 110 ? 2.84 : 1.0 + 0.017 * pageCount;
  if (config.ink === "standard") return 1.0 + 0.0402 * pageCount;
  return pageCount <= 40 ? 4.2 : 1.0 + 0.08 * pageCount;
}
export function effectiveDpi(asset: Pick<Asset, "width" | "height">, rect: Rect, zoom = 1) {
  return Math.min(asset.width / (rect.width / 72), asset.height / (rect.height / 72)) / zoom;
}
export function selectedAsset(target: { selectedAssetId: string | null; candidates: Asset[] }) {
  return target.candidates.find((asset) => asset.id === target.selectedAssetId);
}
export function generationAdequacy(
  config: PrintConfig,
  pageCount: number,
  size: { width: number; height: number },
) {
  const count = Math.max(pageCount, 24);
  const rows = [
    { label: "图文分区", rect: pageGeometry(config, count, 0, "caption").image },
    { label: "整页画面", rect: pageGeometry(config, count, 1, "full").image },
    { label: "封面", rect: coverGeometry(config, count).image },
  ];
  return rows.map((row) => {
    const dpi = Math.floor(effectiveDpi(size, row.rect));
    return { label: row.label, dpi, ok: dpi >= RULES.dpi };
  });
}

export function validateBook(book: Book): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, message: string, pageId?: string) =>
    issues.push({ code, severity: "error", message, pageId });
  const range = pageRange(book.config);
  if (!book.specConfirmed) error("spec-unconfirmed", "请先确认官方出版规格。");
  if (book.pages.length < range.min || book.pages.length > range.max)
    error(
      "page-count",
      `当前 ${book.pages.length} 页；所选印刷组合需要 ${range.min}–${range.max} 页。`,
    );
  if (book.pages.length % 2 !== 0)
    error("odd-pages", "内页为奇数页，请明确添加留白页后再计算封面。");
  for (const [index, page] of book.pages.entries()) {
    if (page.kind === "blank") continue;
    const geometry = pageGeometry(book.config, book.pages.length, index, page.layout);
    if (page.kind === "illustration") {
      const asset = selectedAsset(page);
      if (!asset) error("missing-image", `第 ${index + 1} 页尚未选图。`, page.id);
      else if (effectiveDpi(asset, geometry.image, page.zoom) < 299.95)
        error(
          "low-dpi",
          `第 ${index + 1} 页有效分辨率仅 ${Math.floor(effectiveDpi(asset, geometry.image, page.zoom))} DPI，需要至少 300。`,
          page.id,
        );
      if (asset && !page.imageConfirmed)
        error("review-image", `第 ${index + 1} 页内容或画风改变，请重新确认选图。`, page.id);
    }
    if (page.kind === "text" && !page.title.trim() && !page.text.trim())
      error("empty-text", `第 ${index + 1} 页没有内容；如需留白请设为留白页。`, page.id);
    if (page.text.includes("请在此填写"))
      error("placeholder", `第 ${index + 1} 页仍有模板占位文字，请替换为真实内容。`, page.id);
  }
  const cover = selectedAsset(book.cover);
  if (!book.cover.title.trim()) error("cover-title", "请填写封面书名。");
  if (!book.cover.author.trim()) error("cover-author", "请填写作者署名。");
  if (!cover) error("cover-image", "封面尚未选图。");
  else {
    if (effectiveDpi(cover, coverGeometry(book.config, book.pages.length).image) < 299.95)
      error("cover-dpi", "封面图片实际像素不足 300 DPI。");
    if (!book.cover.imageConfirmed) error("cover-review", "请确认封面选图。");
  }
  issues.push({
    code: "human-review",
    severity: "warning",
    message: "请人工确认动物/文字正确、主体未被裁切，并核对素材与字体授权。",
  });
  issues.push({
    code: "print-preview",
    severity: "warning",
    message: "本地检查不代表 KDP 审核通过；上传后仍须使用 Print Previewer，并建议订购样书。",
  });
  return issues;
}

export function createBook(
  name: string,
  config: PrintConfig = { trim: "8.5x8.5", ink: "premium", bleed: false, paper: "white" },
): Book {
  const now = new Date().toISOString();
  const parsedConfig = printConfigSchema.parse(config);
  return {
    id: crypto.randomUUID(),
    version: 0,
    name,
    createdAt: now,
    updatedAt: now,
    config: parsedConfig,
    specConfirmed: false,
    generationStyleConfirmed: false,
    theme: "",
    language: "English",
    audience: "3–6 岁",
    style: parsedConfig.ink === "black" ? defaultBlackWhiteStyle : defaultColorStyle,
    referenceAssetId: null,
    pages: [],
    cover: {
      title: "",
      author: "",
      description: "",
      prompt: "",
      candidates: [],
      selectedAssetId: null,
      imageConfirmed: false,
      background: "#f5efe3",
    },
  };
}

export function reconcileBook(previous: Book, next: Book): Book {
  const changedStyle =
    previous.style !== next.style || previous.referenceAssetId !== next.referenceAssetId;
  const configChanged = specKey(previous.config) !== specKey(next.config);
  const nextBook = structuredClone(next);
  if (configChanged) nextBook.specConfirmed = false;
  if (configChanged || changedStyle) nextBook.generationStyleConfirmed = false;
  nextBook.pages = nextBook.pages.map((page) => {
    const old = previous.pages.find((item) => item.id === page.id);
    if (old && (configChanged || changedStyle || old.prompt !== page.prompt))
      page.imageConfirmed = false;
    return page;
  });
  if (configChanged || changedStyle || previous.cover.prompt !== next.cover.prompt)
    nextBook.cover.imageConfirmed = false;
  nextBook.id = previous.id;
  nextBook.createdAt = previous.createdAt;
  nextBook.version = previous.version + 1;
  nextBook.updatedAt = new Date().toISOString();
  return nextBook;
}

export function alphabetPages() {
  const animals = [
    "Alligator",
    "Bear",
    "Cat",
    "Dog",
    "Elephant",
    "Fox",
    "Giraffe",
    "Hippo",
    "Iguana",
    "Jaguar",
    "Koala",
    "Lion",
    "Monkey",
    "Narwhal",
    "Owl",
    "Penguin",
    "Quail",
    "Rabbit",
    "Snake",
    "Tiger",
    "Urial",
    "Vulture",
    "Whale",
    "X-ray tetra",
    "Yak",
    "Zebra",
  ];
  const textPage = (title: string, text: string) => ({
    ...newPage(),
    kind: "text" as const,
    title,
    text,
  });
  return [
    textPage("My Animal Alphabet", "A little journey from A to Z"),
    textPage("关于这本书", "请在此填写真实的版权信息和素材声明。"),
    textPage("Let’s explore!", "Find an animal for every letter."),
    ...animals.map((animal, index) => ({
      ...newPage(),
      title: `${String.fromCharCode(65 + index)}  ${animal}`,
      prompt: `A friendly ${animal.toLowerCase()}, clear recognizable anatomy, simple uncluttered scene, child-friendly picture book illustration. No letters or words.`,
    })),
    textPage("Can you remember?", "Which animal is your favorite?"),
    textPage("The end", "There is always more to discover."),
    { ...newPage(), kind: "blank" as const },
  ];
}
