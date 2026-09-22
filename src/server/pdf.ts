import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, type PDFFont, type PDFPage, cmyk } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import { type Book, type Issue, type Rect, type ExportResult, type Asset } from "@/domain/book";
import {
  RULES,
  TEXT_COLORS,
  inkLabel,
  paperLabel,
  pageGeometry,
  coverGeometry,
  selectedAsset,
  validateBook,
} from "@/domain/print-spec";
import { store } from "./store";
import { AppError, ExportValidationError } from "./errors";
import { embedCffFontProgram } from "./pdf-font";

let fontBytes: Promise<Buffer> | undefined;
function fontData() {
  return (fontBytes ??= readFile(
    path.join(process.cwd(), "assets/fonts/NotoSansCJKsc-Regular.otf"),
  ));
}
const white = cmyk(0, 0, 0, 0),
  ink = cmyk(0, 0, 0, 0.88);
function paint(page: PDFPage, rect: Rect, color = white) {
  page.drawRectangle({
    x: rect.x,
    y: page.getHeight() - rect.y - rect.height,
    width: rect.width,
    height: rect.height,
    color,
  });
}
function colorFromHex(hex: string) {
  const red = parseInt(hex.slice(1, 3), 16) / 255,
    green = parseInt(hex.slice(3, 5), 16) / 255,
    blue = parseInt(hex.slice(5, 7), 16) / 255;
  const black = 1 - Math.max(red, green, blue);
  return black === 1
    ? cmyk(0, 0, 0, 1)
    : cmyk(
        (1 - red - black) / (1 - black),
        (1 - green - black) / (1 - black),
        (1 - blue - black) / (1 - black),
        black,
      );
}
export function wrapText(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n/g, "\n").split("\n")) {
    let line = "";
    const tokens = paragraph.match(/[A-Za-z0-9][A-Za-z0-9'’.,!?\-]*|\s+|[^\s]/gu) || [];
    for (const token of tokens) {
      if (font.widthOfTextAtSize(line + token, size) <= width) {
        line += token;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = "";
      if (font.widthOfTextAtSize(token, size) <= width) {
        line = token.trimStart();
        continue;
      }
      for (const character of token) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
function textBlock(
  page: PDFPage,
  font: PDFFont,
  title: string,
  body: string,
  rect: Rect,
  size: number,
  issues: Issue[],
  location?: { id: string; number: number },
  color: ReturnType<typeof cmyk> = ink,
) {
  const label = location ? `第 ${location.number} 页` : "封面";
  const characters = new Set(font.getCharacterSet());
  const text = (title + body).replace(/[\n\r\t]/g, "");
  const missing = [
    ...new Set([...text].filter((character) => !characters.has(character.codePointAt(0)!))),
  ];
  if (missing.length)
    issues.push({
      code: location ? "missing-glyph" : "cover-missing-glyph",
      severity: "error",
      message: `${label}字体不支持这些字符：${missing.slice(0, 10).join(" ")}`,
      pageId: location?.id,
    });
  let top = rect.y;
  for (const [content, fontSize] of [
    [title, size * 1.25],
    [body, size],
  ] as const) {
    if (!content) continue;
    const lines = wrapText(content, font, fontSize, rect.width);
    let overflowing = false;
    for (const line of lines) {
      if (top + fontSize * 1.25 > rect.y + rect.height) {
        overflowing = true;
        break;
      }
      page.drawText(line, {
        x: rect.x,
        y: page.getHeight() - top - fontSize,
        font,
        size: fontSize,
        color,
      });
      top += fontSize * 1.5;
    }
    if (overflowing) {
      issues.push({
        code: location ? "text-overflow" : "cover-text-overflow",
        severity: "error",
        message: location
          ? `${label}文字超出安全区，请缩短文字或减小字号。`
          : "封面文字超出安全区，请缩短书名、署名或简介。",
        pageId: location?.id,
      });
      break;
    }
    top += size * 0.5;
  }
}
async function imageFor(
  asset: Asset,
  bytes: Buffer,
  rect: Rect,
  zoom = 1,
  offsetX = 0.5,
  offsetY = 0.5,
  grayscale = false,
) {
  const ratio = rect.width / rect.height;
  const cropWidth = Math.max(1, Math.floor(Math.min(asset.width, asset.height * ratio) / zoom));
  const cropHeight = Math.max(1, Math.min(asset.height, Math.floor(cropWidth / ratio)));
  const left = Math.max(0, Math.floor((asset.width - cropWidth) * offsetX));
  const top = Math.max(0, Math.floor((asset.height - cropHeight) * offsetY));
  return sharp(bytes)
    .flatten({ background: "#ffffff" })
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(Math.ceil((rect.width / 72) * 300), Math.ceil((rect.height / 72) * 300), {
      fit: "fill",
    })
    .grayscale(grayscale)
    .withIccProfile("cmyk")
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

export async function renderBook(
  book: Book,
  readAsset: (id: string) => Promise<Buffer>,
  draft: boolean,
  target: "all" | "interior" = "all",
) {
  const includeCover = target === "all";
  const issues = validateBook(book).filter(
    (issue) => includeCover || !issue.code.startsWith("cover-"),
  );
  const interior = await PDFDocument.create(),
    cover = await PDFDocument.create();
  interior.registerFontkit(fontkit);
  cover.registerFontkit(fontkit);
  const font = await interior.embedFont(await fontData(), { subset: false }),
    coverFont = await cover.embedFont(await fontData(), { subset: false });
  const cache = new Map<string, Awaited<ReturnType<PDFDocument["embedJpg"]>>>();
  async function drawImage(
    document: PDFDocument,
    page: PDFPage,
    asset: Asset,
    rect: Rect,
    zoom = 1,
    offsetX = 0.5,
    offsetY = 0.5,
  ) {
    const key = JSON.stringify([
      document === interior ? "interior" : "cover",
      asset.id,
      rect.width,
      rect.height,
      zoom,
      offsetX,
      offsetY,
    ]);
    let image = cache.get(key);
    if (!image) {
      image = await document.embedJpg(
        await imageFor(
          asset,
          await readAsset(asset.id),
          rect,
          zoom,
          offsetX,
          offsetY,
          document === interior && book.config.ink === "black",
        ),
      );
      cache.set(key, image);
    }
    page.drawImage(image, {
      x: rect.x,
      y: page.getHeight() - rect.y - rect.height,
      width: rect.width,
      height: rect.height,
    });
  }
  function stamp(page: PDFPage, embedded: PDFFont) {
    if (draft)
      page.drawText("DRAFT · 草稿，仅用于检查，不可上传", {
        x: 12,
        y: 7,
        size: 8,
        font: embedded,
        color: cmyk(0, 0.8, 0.8, 0.1),
      });
  }
  for (const [index, content] of book.pages.entries()) {
    const geometry = pageGeometry(book.config, book.pages.length, index, content.layout);
    const page = interior.addPage([geometry.width, geometry.height]);
    paint(page, { x: 0, y: 0, width: geometry.width, height: geometry.height });
    if (content.kind !== "blank") {
      const asset = selectedAsset(content);
      if (content.kind === "illustration" && asset)
        await drawImage(
          interior,
          page,
          asset,
          geometry.image,
          content.zoom,
          content.offsetX,
          content.offsetY,
        );
      if (
        content.kind === "illustration" &&
        content.layout === "full" &&
        (content.title || content.text)
      )
        paint(page, {
          x: geometry.text.x - 8,
          y: geometry.text.y - 8,
          width: geometry.text.width + 16,
          height: geometry.text.height + 8,
        });
      textBlock(
        page,
        font,
        content.title,
        content.text,
        content.kind === "text" ? geometry.safe : geometry.text,
        content.fontSize,
        issues,
        { id: content.id, number: index + 1 },
        colorFromHex(TEXT_COLORS[content.textColor].hex),
      );
    }
    stamp(page, font);
  }
  if (!book.pages.length) {
    const geometry = pageGeometry(book.config, 0, 0, "caption");
    const page = interior.addPage([geometry.width, geometry.height]);
    stamp(page, font);
  }
  if (includeCover) {
    const geometry = coverGeometry(book.config, book.pages.length);
    const page = cover.addPage([geometry.width, geometry.height]);
    paint(
      page,
      { x: 0, y: 0, width: geometry.width, height: geometry.height },
      colorFromHex(book.cover.background),
    );
    const asset = selectedAsset(book.cover);
    if (asset) await drawImage(cover, page, asset, geometry.image);
    paint(page, geometry.headingPanel);
    textBlock(page, coverFont, book.cover.title, book.cover.author, geometry.heading, 26, issues);
    textBlock(page, coverFont, "", book.cover.description, geometry.backText, 18, issues);
    paint(page, geometry.barcode);
    stamp(page, coverFont);
  }
  if (!draft && issues.some((issue) => issue.severity === "error")) return { issues };
  await embedCffFontProgram(interior, await fontData());
  if (includeCover) await embedCffFontProgram(cover, await fontData());
  interior.context.trailerInfo.Info = undefined;
  cover.context.trailerInfo.Info = undefined;
  const interiorBytes = await interior.save(),
    coverBytes = includeCover ? await cover.save() : undefined;
  if (interiorBytes.length > 650 * 1024 * 1024 || (coverBytes?.length || 0) > 650 * 1024 * 1024)
    throw new AppError("PDF 超过 KDP 的文件大小上限，请减少图片体积后导出。");
  return { interior: interiorBytes, cover: coverBytes, issues };
}

export async function exportBook(
  projectId: string,
  draft: boolean,
  reviewed: boolean,
  target: "all" | "interior" = "all",
): Promise<ExportResult> {
  if (!draft && !reviewed) throw new AppError("请先确认内容、权利与裁切检查。");
  const book = await store.read(projectId);
  const result = await renderBook(book, (id) => store.assetBytes(id), draft, target);
  if (!result.interior || (target === "all" && !result.cover)) {
    throw new ExportValidationError(result.issues);
  }
  const current = await store.read(projectId);
  if (current.version !== book.version)
    throw new AppError("导出期间项目内容已改变，请重新导出以免使用旧版本。", 409);
  const version = `${draft ? "draft" : "print"}-${book.version}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const parent = path.join(store.root, "exports", projectId),
    temporary = path.join(parent, `.${version}.tmp`);
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  const notes = [
    `项目：${book.name}`,
    `内容版本：${book.version}`,
    `文件性质：${draft ? "草稿，禁止上传" : "已通过本工具检查，尚未通过 KDP 审核"}`,
    `规格：${book.config.trim} 英寸 / ${inkLabel(book.config.ink)} / ${paperLabel(book.config.paper)} / ${book.config.bleed ? "内页出血" : "内页不出血"}`,
    `内页：${book.pages.length} 页，封面另计`,
    `图片已扁平化并转换为 CMYK JPEG${book.config.ink === "black" ? "（仅内页插图转灰度；封面插图不随内页墨水设置转灰度）" : ""}，字体嵌入。屏幕与印刷仍可能有色差，本工具不宣称 PDF/X 认证。`,
    `官方规则版本：${RULES.version}`,
    `官方内页规则：${RULES.manuscriptUrl}`,
    `封面模板核对：${RULES.calculatorUrl}`,
    "上传时按上述参数选择 KDP 选项；本书不印书脊文字，由 KDP 添加条码。",
    "请人工核对书名/作者与 KDP 资料一致，按要求申报 AI 生成内容；使用 Print Previewer 并建议订购样书。",
    "封底白色区域预留条码，不是遗漏内容。",
    `生成时间：${new Date().toISOString()}`,
    ...result.issues.map((issue) => `${issue.severity}: ${issue.message}`),
  ].join("\n");
  await writeFile(path.join(temporary, "interior.pdf"), result.interior, { mode: 0o600 });
  if (result.cover)
    await writeFile(path.join(temporary, "cover.pdf"), result.cover, { mode: 0o600 });
  await writeFile(
    path.join(temporary, "upload-notes.txt"),
    `输出范围：${target === "interior" ? "仅内页，封面尚未随本次导出；不代表整本出版文件已齐" : "完整内页与封面"}\n${notes}`,
    { mode: 0o600 },
  );
  await writeFile(path.join(temporary, "snapshot.json"), JSON.stringify(book, null, 2), {
    mode: 0o600,
  });
  await rename(temporary, path.join(parent, version));
  return {
    version,
    draft,
    createdAt: new Date().toISOString(),
    issues: result.issues,
    files: (result.cover
      ? ["interior.pdf", "cover.pdf", "upload-notes.txt"]
      : ["interior.pdf", "upload-notes.txt"]
    ).map((name) => ({ name, url: `/api/exports/${projectId}/${version}/${name}` })),
  };
}
