import { describe, expect, it } from "vitest";
import {
  bookSchema,
  defaultBlackWhiteStyle,
  defaultColorStyle,
  newPage,
  pageSchema,
  printConfigSchema,
  styleAfterInkChange,
  type Book,
  type PrintConfig,
} from "../src/domain/book";
import {
  RULES,
  TEXT_COLORS,
  aspectRatioLabel,
  coverGeometry,
  generationAdequacy,
  pageGeometry,
  pixelRequirements,
  effectiveDpi,
  pageRange,
  printingCostEstimate,
  royaltyEstimate,
  sizeLabel,
  validateBook,
  specKey,
  spineCoefficient,
  reconcileBook,
  createBook,
} from "../src/domain/print-spec";

const config: PrintConfig = { trim: "8.5x8.5", ink: "premium", bleed: true, paper: "white" };
describe("KDP official print constraints", () => {
  it("uses the official page range per trim, not a shared maximum", () => {
    expect(RULES.trims["8x10"].premiumMax).toBe(828);
    expect(RULES.trims["8.5x8.5"].premiumMax).toBe(590);
  });
  it("adds bleed only to the outside edge and switches sides", () => {
    const right = pageGeometry(config, 32, 0, "full");
    const left = pageGeometry(config, 32, 1, "full");
    expect(right.width / 72).toBe(8.625);
    expect(right.height / 72).toBe(8.75);
    expect(right.trim.x).toBe(0);
    expect(left.trim.x).toBe(9);
    expect(pixelRequirements(right.image)).toEqual({ width: 2588, height: 2625 });
  });
  it("uses different spine coefficients for premium and standard color", () => {
    expect(coverGeometry(config, 32).spine / 72).toBeCloseTo(32 * 0.002347);
    expect(coverGeometry({ ...config, ink: "standard" }, 72).spine / 72).toBeCloseTo(72 * 0.002252);
  });
  it("supports black ink with official page ranges per paper", () => {
    expect(pageRange({ trim: "8x10", ink: "black", bleed: false, paper: "white" })).toEqual({
      min: 24,
      max: 828,
    });
    expect(pageRange({ trim: "8.5x8.5", ink: "black", bleed: false, paper: "white" })).toEqual({
      min: 24,
      max: 590,
    });
    expect(pageRange({ trim: "8.5x8.5", ink: "black", bleed: false, paper: "cream" })).toEqual({
      min: 24,
      max: 550,
    });
    expect(pageRange({ trim: "8.5x11", ink: "black", bleed: false, paper: "cream" })).toEqual({
      min: 24,
      max: 550,
    });
    expect(pageRange({ trim: "8x10", ink: "black", bleed: false, paper: "cream" })).toEqual({
      min: 24,
      max: 776,
    });
  });
  it("uses official spine coefficients for black ink papers", () => {
    const blackWhite: PrintConfig = { trim: "8.5x8.5", ink: "black", bleed: false, paper: "white" };
    const blackCream: PrintConfig = { ...blackWhite, paper: "cream" };
    expect(spineCoefficient(blackWhite)).toBeCloseTo(0.002252);
    expect(spineCoefficient(blackCream)).toBeCloseTo(0.0025);
    expect(coverGeometry(blackCream, 100).spine / 72).toBeCloseTo(100 * 0.0025);
  });
  it("restricts color inks to white paper while black ink may use cream", () => {
    expect(
      printConfigSchema.safeParse({ trim: "8.5x8.5", ink: "premium", bleed: false, paper: "cream" })
        .success,
    ).toBe(false);
    expect(
      printConfigSchema.safeParse({
        trim: "8.5x8.5",
        ink: "standard",
        bleed: false,
        paper: "cream",
      }).success,
    ).toBe(false);
    expect(
      printConfigSchema.safeParse({ trim: "8.5x8.5", ink: "black", bleed: false, paper: "cream" })
        .success,
    ).toBe(true);
    expect(
      printConfigSchema.safeParse({ trim: "8.5x8.5", ink: "black", bleed: false, paper: "white" })
        .success,
    ).toBe(true);
  });
  it("supports the classic 8.25x8.25 square trim with official ranges", () => {
    expect(pageRange({ trim: "8.25x8.25", ink: "black", bleed: false, paper: "white" })).toEqual({
      min: 24,
      max: 800,
    });
    expect(pageRange({ trim: "8.25x8.25", ink: "black", bleed: false, paper: "cream" })).toEqual({
      min: 24,
      max: 750,
    });
    expect(pageRange({ trim: "8.25x8.25", ink: "premium", bleed: false, paper: "white" })).toEqual({
      min: 24,
      max: 800,
    });
    expect(pageRange({ trim: "8.25x8.25", ink: "standard", bleed: false, paper: "white" })).toEqual(
      { min: 72, max: 600 },
    );
  });
  it("reports whether the configured request size can print each layout", () => {
    const black: PrintConfig = { trim: "8.5x8.5", ink: "black", bleed: false, paper: "cream" };
    const tooSmall = generationAdequacy(black, 26, { width: 1024, height: 1024 });
    expect(tooSmall.map((row) => row.ok)).toEqual([false, false, false]);
    const adequate = generationAdequacy(black, 26, { width: 2800, height: 2800 });
    expect(adequate.map((row) => row.ok)).toEqual([true, true, true]);
    expect(adequate[2].label).toBe("封面");
  });
  it("swaps the default art style only when it was never customized", () => {
    expect(styleAfterInkChange("black", defaultColorStyle)).toBe(defaultBlackWhiteStyle);
    expect(styleAfterInkChange("premium", defaultBlackWhiteStyle)).toBe(defaultColorStyle);
    const custom = "我自己的画风";
    expect(styleAfterInkChange("black", custom)).toBe(custom);
  });
  it("reports sizes in inches and millimeters side by side", () => {
    expect(sizeLabel(8.5, 8.5)).toBe("8.500 × 8.500 in（215.9 × 215.9 mm）");
    expect(sizeLabel(8.625, 8.75)).toBe("8.625 × 8.750 in（219.1 × 222.3 mm）");
  });
  it("describes the target art aspect ratio for a layout", () => {
    expect(aspectRatioLabel({ x: 0, y: 0, width: 540, height: 367.2 })).toBe(
      "≈ 1.47 : 1（宽 : 高）",
    );
    expect(aspectRatioLabel({ x: 0, y: 0, width: 650.25, height: 738 })).toBe(
      "≈ 0.88 : 1（宽 : 高）",
    );
  });
  it("estimates US large-trim printing cost from official tiers", () => {
    const black: PrintConfig = { trim: "8.5x8.5", ink: "black", bleed: false, paper: "cream" };
    expect(printingCostEstimate(black, 26)).toBeCloseTo(2.84, 2);
    expect(printingCostEstimate(black, 110)).toBeCloseTo(2.84, 2);
    expect(printingCostEstimate(black, 112)).toBeCloseTo(1.0 + 0.017 * 112, 2);
    expect(printingCostEstimate({ ...black, ink: "premium" }, 32)).toBeCloseTo(4.2, 2);
    expect(printingCostEstimate({ ...black, ink: "premium" }, 42)).toBeCloseTo(1.0 + 0.08 * 42, 2);
    expect(printingCostEstimate({ ...black, ink: "standard" }, 72)).toBeCloseTo(
      1.0 + 0.0402 * 72,
      2,
    );
  });
  it("requires 72 pages for standard color and an explicitly even page count", () => {
    const book = createBook("试做");
    book.specConfirmed = true;
    book.config.ink = "standard";
    book.pages = Array.from({ length: 25 }, () => ({ ...newPage(), kind: "blank" as const }));
    const issues = validateBook(book);
    expect(issues.some((issue) => issue.code === "page-count")).toBe(true);
    expect(issues.some((issue) => issue.code === "odd-pages")).toBe(true);
  });
  it("uses actual cropped pixels, not a DPI label", () => {
    expect(
      effectiveDpi({ width: 1024, height: 1024 }, { x: 0, y: 0, width: 612, height: 612 }, 1),
    ).toBeCloseTo(120.47, 1);
    expect(
      effectiveDpi({ width: 3000, height: 3000 }, { x: 0, y: 0, width: 612, height: 612 }, 2),
    ).toBeCloseTo(176.47, 1);
  });
  it("invalidates spec confirmation and keeps existing candidates when a specification changes", () => {
    const original = createBook("test");
    original.specConfirmed = true;
    original.generationStyleConfirmed = true;
    original.pages = [{ ...newPage(), imageConfirmed: true }];
    original.cover.imageConfirmed = true;
    const edited: Book = structuredClone(original);
    edited.config.bleed = !original.config.bleed;
    edited.specConfirmed = true;
    const reconciled = reconcileBook(original, edited);
    expect(reconciled.specConfirmed).toBe(false);
    expect(reconciled.generationStyleConfirmed).toBe(false);
    expect(reconciled.pages[0].imageConfirmed).toBe(false);
    expect(reconciled.cover.imageConfirmed).toBe(false);
    expect(specKey(original.config)).not.toBe(specKey(reconciled.config));
  });
  it("changing prompts invalidates review without silently changing the selected image", () => {
    const original = createBook("test");
    original.pages = [newPage()];
    original.pages[0].imageConfirmed = true;
    const edited = structuredClone(original);
    edited.pages[0].prompt = "new animal";
    expect(reconcileBook(original, edited).pages[0].imageConfirmed).toBe(false);
  });
});
it("keeps text color presets aligned with the page schema default", () => {
  const stripped = JSON.parse(JSON.stringify({ ...newPage(), textColor: undefined }));
  expect(pageSchema.parse(stripped).textColor).toBe("ink");
  expect(Object.keys(TEXT_COLORS)).toEqual(["ink", "sepia", "navy", "slate", "warmgray"]);
});

describe("US paperback royalty estimate", () => {
  const black: PrintConfig = { trim: "8.5x8.5", ink: "black", bleed: false, paper: "cream" };
  it("applies the official 50%/60% breakpoint at $9.98/$9.99", () => {
    const low = royaltyEstimate(black, 26, 9.98);
    expect(low.rate).toBe(0.5);
    expect(low.royalty).toBeCloseTo(0.5 * 9.98 - 2.84, 4);
    const high = royaltyEstimate(black, 26, 9.99);
    expect(high.rate).toBe(0.6);
    expect(high.royalty).toBeCloseTo(0.6 * 9.99 - 2.84, 4);
    expect(high.royalty - low.royalty).toBeGreaterThan(0.9);
  });
  it("marks prices near the threshold and computes expanded distribution at 40%", () => {
    expect(royaltyEstimate(black, 26, 9.5).nearThreshold).toBe(true);
    expect(royaltyEstimate(black, 26, 8.99).nearThreshold).toBe(false);
    expect(royaltyEstimate(black, 26, 10.5).nearThreshold).toBe(false);
    expect(royaltyEstimate(black, 26, 12).expandedRoyalty).toBeCloseTo(0.4 * 12 - 2.84, 4);
  });
  it("keeps list price optional in the book schema with a null default", () => {
    const book = createBook("定价测试");
    expect(book.listPrice).toBeNull();
    const restored = bookSchema.parse({ ...book, listPrice: undefined });
    expect(restored.listPrice).toBeNull();
    const priced = bookSchema.parse({ ...book, listPrice: 9.99 });
    expect(priced.listPrice).toBeCloseTo(9.99, 6);
  });
});
