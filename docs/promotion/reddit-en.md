# Reddit 草稿（r/selfpublish）

> 发前必读当周版规。若自推广只允许在周六 Check-in 线程，用「短版」；允许独立发帖时用「主帖」。

## 主帖

**标题：** I open-sourced the local tool I built to make my KDP picture book print-ready — MIT, no accounts, everything stays on your machine

**正文：**

I'm working on my first picture book for KDP (a 26-page black & white one) and kept making the same mistakes: wrong page counts for my ink/paper combo, images that looked fine on screen but were ~120 DPI at print size, cover spine width computed from the wrong constant. The specs are all public, but scattered across four different KDP help pages.

So I built a small workbench and just open-sourced it: **https://github.com/anmutu/kdp-helper**

What it does:

- You pick trim size, ink (B&W white/cream, standard, premium color), paper and bleed first — it shows the exact page ranges, spine width, margins and minimum pixel requirements, each tied to the official KDP page it came from (with the date I checked it)
- Then pages → illustrations (call your own image API, or just import your own art — no key needed) → pick candidates side-by-side → lay out text and cover → export `interior.pdf` + a full wraparound `cover.pdf` + an upload-notes file
- It's stubborn about money and correctness: it refuses a paid generation call if the requested pixels can't print at 300 DPI, pauses the whole batch the moment one low-res image comes back, and blocks the final export on odd page counts, missing glyphs, text overflow or placeholder text
- Prints cost & US royalty estimate as you type — including the fun fact that $9.98 vs $9.99 pricing crosses a 50%→60% royalty breakpoint

Honest limitations: the UI is currently Chinese-first (README has an English section, i18n is on the roadmap); specs are checked against the US marketplace docs; it runs locally with Node (dev machine is macOS, Linux should work, Windows untested). It exports files — it never uploads or publishes for you.

Free, MIT, no account, no telemetry, data stays in a local folder. Happy to answer anything.

## 短版（周六 Check-in 线程回复）

Sharing a free MIT tool I built for my own KDP picture book: https://github.com/anmutu/kdp-helper — local-first workbench that keeps print specs honest (page ranges, spine width, 300-DPI pixel minimums from official KDP docs), guards against paying for images that can't print, and exports validated interior + cover PDFs. UI is Chinese-first for now; README explains everything in English. Questions welcome!

## 备用回复（按评论直接粘贴/改写）

**Q: Is it Mac only?**
Node.js app — should run anywhere Node 24 does. Developed and tested on macOS; sharp ships prebuilt binaries for Linux; Windows untested so far. (It only ever listens on 127.0.0.1.)

**Q: Does it upload/publish to KDP for me?**
No, deliberately. It exports the two PDFs plus an upload-notes file listing the exact options to pick in KDP. You stay in control of the actual upload, previewer and AI-content declaration.

**Q: AI illustrations? I don't want that.**
The AI part is optional — no API key needed. Plenty of the checks (specs, DPI, spine, export validation) work with fully hand-imported art. Every page must be picked and confirmed by you either way.

**Q: What does it cost?**
The tool is free and MIT. If you do hook up image generation, that's billed by your own provider — the tool shows cost guardrails (blocks calls it knows can't print, pauses on low-res results) and a printing-cost + royalty estimator.

**Q: English UI?**
Not yet — Chinese-first right now, English README, i18n on the roadmap. Code and docs are English-friendly; PRs welcome.
