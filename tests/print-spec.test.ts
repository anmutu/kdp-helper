import { describe, expect, it } from "vitest";
import { newPage, printConfigSchema, type Book, type PrintConfig } from "../src/domain/book";
import {
  RULES,
  coverGeometry,
  pageGeometry,
  pixelRequirements,
  effectiveDpi,
  pageRange,
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
    const edited: Book = structuredClone(original);
    edited.config.bleed = !original.config.bleed;
    edited.specConfirmed = true;
    const reconciled = reconcileBook(original, edited);
    expect(reconciled.specConfirmed).toBe(false);
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
