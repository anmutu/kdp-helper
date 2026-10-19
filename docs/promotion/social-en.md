# X / Twitter 推文串草稿

> 逐条发出；第 1 条单独可读。链接放第 1 条或第 2 条。

1. I'm self-publishing a picture book on Amazon KDP and every GUI tool happily let me export an unprintable book. So I built my own and open-sourced it (MIT). 🧵

2. KDP Helper is a local workbench for the whole loop: verified print specs → pages → illustrations → side-by-side candidate picking → layout → validated interior.pdf + wraparound cover.pdf. https://github.com/anmutu/kdp-helper

3. The core idea: every print rule (page ranges per trim/ink/paper, spine width, bleed geometry, 300-DPI pixel minimums) is a pure function with a source URL and a checked date. Nothing is guessed. If the rules change, the module and its 115 tests change.

4. It guards money too: paid image-generation calls are blocked if the requested pixels can't print; the batch pauses the moment a low-res image comes back; uncertain requests are never auto-retried. Plus a US cost + royalty estimator — including the $9.98 → $9.99 royalty breakpoint (50% → 60%).

5. Privacy stance: no account, no cloud, no telemetry. Your API key stays in a local file. It listens on 127.0.0.1 only. Works fully offline if you import your own art.

6. Honest limits: UI is Chinese-first (English README), US-market specs, macOS/Node 24 tested. It exports files — you do the KDP upload yourself, on purpose. MIT, free: https://github.com/anmutu/kdp-helper
