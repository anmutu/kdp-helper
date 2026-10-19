# Show HN 草稿

## 标题（三选一）

1. `Show HN: Open-source local workbench for print-ready KDP picture books`
2. `Show HN: I built a spec-checked picture-book pipeline for Amazon KDP`
3. `Show HN: A local tool that stops you exporting an unprintable KDP book`

## 正文

I'm making my first picture book for Amazon KDP and kept hitting the same class of mistakes: page counts that don't fit my ink/paper combo, images that are ~120 DPI at final print size, spine widths computed with the wrong constant. The rules are public but scattered across four KDP help pages, and every GUI tool I tried was happy to let me export something unprintable.

So I built my own and open-sourced it (MIT): https://github.com/anmutu/kdp-helper

It's a local Next.js app — no accounts, no cloud, listens on 127.0.0.1 only. The whole print-spec layer is a pure TypeScript module where every number (page ranges per trim/ink/paper, spine coefficients, bleed geometry, gutter tiers, 300-DPI pixel minimums) carries its official source URL and the date I checked it. If Amazon changes the rules, the module and its tests change — nothing is guessed at runtime.

The export path refuses to produce a "final" file when something is wrong: odd page count, missing glyphs, text overflow, sub-300-DPI images, unconfirmed selections, placeholder text. Drafts always export (watermarked) so you can inspect real PDFs. Images are flattened to CMYK JPEG with an embedded CJK font; the tricky part was convincing pdf-lib to embed a CIDFontType0C program properly — that took a while.

It also guards money: image generation goes through your own API key, and the tool blocks a paid call when the requested pixels can't print, and pauses the batch the moment one result comes back too small. There's a US printing-cost + royalty estimator (with the $9.98/$9.99 rate breakpoint).

Honest limits: UI is Chinese-first (English README; i18l planned), specs checked against the US marketplace, developed on macOS/Node 24. No upload automation by design.

Interested in what HN thinks about the "specs as a versioned pure module" approach — it's proven great for tests (115 of them), curious if others have done this for other print-on-demand platforms.
