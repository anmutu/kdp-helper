import { useState } from "react";
import { ArrowUpRight, Check, Download, FileCheck2, TriangleAlert } from "lucide-react";
import type { Book, ExportResult } from "@/domain/book";
import { coverGeometry, pageGeometry, validateBook } from "@/domain/print-spec";
import { Field } from "./controls";
import { exportIssues, type ExportTarget } from "./ui-helpers";
import type { Workbench } from "./use-workbench";

export function ExportStage({
  store,
  goToPage,
}: {
  store: Workbench;
  goToPage: (id?: string) => void;
}) {
  const book = store.book as Book;
  const [reviewedSnapshot, setReviewedSnapshot] = useState("");
  const [result, setResult] = useState<ExportResult | null>(null);
  const [exportedSnapshot, setExportedSnapshot] = useState("");
  const [target, setTarget] = useState<ExportTarget>("all");
  const [resultTarget, setResultTarget] = useState<ExportTarget>("all");
  const signature = JSON.stringify({ book, target });
  const reviewed = reviewedSnapshot === signature;
  const issues = exportIssues(validateBook(book), target);
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const copyrightPlaceholder = book.pages.some((page) => page.text.includes("请在此填写"));
  const interior = pageGeometry(book.config, book.pages.length, 0, "full");
  const cover = coverGeometry(book.config, book.pages.length);
  async function exportPdf(draft: boolean) {
    const exported = await store.exportBook(draft, draft ? false : reviewed, target);
    if (exported) {
      setResult(exported);
      setExportedSnapshot(signature);
      setResultTarget(target);
    }
  }
  return (
    <div className="stage-stack">
      <section className="panel export-summary">
        <div>
          <span className="eyebrow">交给印刷之前</span>
          <h2>最后，认真翻一遍。</h2>
          <p>检查尺寸只是开始。内容、授权与每一处裁切，都需要作者亲自确认。</p>
        </div>
        <FileCheck2 size={54} strokeWidth={1} />
      </section>
      <section className="panel form-stack">
        <Field
          label="本次导出范围"
          hint="草稿和正式文件均使用此范围；变更范围后，需要重新勾选人工审核。"
        >
          <select
            value={target}
            disabled={store.locked}
            onChange={(event) => {
              setTarget(event.target.value as ExportTarget);
              setReviewedSnapshot("");
            }}
          >
            <option value="all">完整绘本 · 内页与封面</option>
            <option value="interior">仅导出内页</option>
          </select>
        </Field>
        {target === "interior" && (
          <p className="notice">
            本次只生成内页 PDF
            和上传说明，不要求封面检查通过。仅内页导出成功不代表全书齐备；封面尚未完成时，仍需另行制作并审核封面。
          </p>
        )}
      </section>
      <div className="export-columns">
        <section className="panel">
          <div className="section-heading">
            <h2>{target === "interior" ? "内页文件检查" : "文件检查"}</h2>
            <span className={`small-tag ${errors.length ? "warning" : ""}`}>
              {errors.length} 项待处理
            </span>
          </div>
          <div className="export-specs">
            <div>
              <span>内页 PDF</span>
              <strong>{book.pages.length} 页 · 单页序列</strong>
              <small>
                {(interior.width / 72).toFixed(3)} × {(interior.height / 72).toFixed(3)} in
              </small>
            </div>
            <div>
              <span>封面 PDF</span>
              <strong>{target === "interior" ? "本次不检查、不导出" : "封底 + 书脊 + 封面"}</strong>
              {target === "all" && (
                <small>
                  {(cover.width / 72).toFixed(3)} × {(cover.height / 72).toFixed(3)} in
                </small>
              )}
            </div>
          </div>
          {!errors.length && (
            <p className="success check-row">
              <Check size={18} />
              已通过当前{target === "interior" ? "内页" : "完整绘本"}
              客户端规格检查；导出时仍由服务端最终校验。
            </p>
          )}
          <ul className="issue-list">
            {errors.map((issue, index) => (
              <li key={`${issue.code}-${issue.pageId}-${index}`}>
                <TriangleAlert size={17} />
                <span>{issue.message}</span>
                <button className="text-button" onClick={() => goToPage(issue.pageId)}>
                  去处理
                </button>
              </li>
            ))}
          </ul>
          {copyrightPlaceholder && (
            <p className="notice error">
              示例版权页仍含“请在此填写”。请在第一步改为真实版权与素材声明；正式导出会被服务端阻止。
            </p>
          )}
          <div className="review-warnings">
            {warnings.map((issue) => (
              <p key={issue.code}>{issue.message}</p>
            ))}
          </div>
        </section>
        <section className="panel export-actions">
          <span className="eyebrow">先打样，再定稿</span>
          <h2>制作出版文件</h2>
          <p>
            每次导出保留独立版本；不会覆盖之前的文件。草稿可能含缺图或低清内容，不用于上传出版。
          </p>
          <button className="button" disabled={store.locked} onClick={() => void exportPdf(true)}>
            <Download size={17} />
            {store.busy === "正在制作 PDF…"
              ? "正在制作…"
              : target === "interior"
                ? "导出内页草稿 PDF"
                : "导出草稿 PDF"}
          </button>
          <div className="export-divider" />
          <label className="check-row">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={store.locked || store.saveState !== "saved"}
              onChange={(event) => setReviewedSnapshot(event.target.checked ? signature : "")}
            />
            <span>
              我已人工审核本次{target === "interior" ? "内页" : "完整绘本"}内容
              <span className="field-hint">
                文字与动物内容正确；裁切、阅读顺序和版权页无误；素材和字体有使用权；我会按 KDP
                要求申报 AI 内容。书本或导出范围改动后需重新确认。
              </span>
            </span>
          </label>
          <button
            className="button primary"
            disabled={
              store.locked ||
              store.saveState !== "saved" ||
              !reviewed ||
              errors.length > 0 ||
              copyrightPlaceholder
            }
            onClick={() => void exportPdf(false)}
          >
            <FileCheck2 size={18} />
            {store.busy === "正在制作 PDF…"
              ? "正在制作…"
              : target === "interior"
                ? "导出正式内页文件"
                : "导出正式出版文件"}
          </button>
          <p className="field-hint">
            正式导出需要检查通过并勾选人工审核，包括仅内页导出。导出不等于 KDP 审核通过。
          </p>
        </section>
      </div>
      {result && (
        <section className="panel exported-files" aria-live="polite">
          <div className="section-heading">
            <div>
              <span className="eyebrow">服务端已返回导出结果</span>
              <h2>
                {resultTarget === "interior" ? "仅内页 · " : "完整绘本 · "}
                {result.draft ? "草稿文件" : "出版文件"} · {result.version}
              </h2>
            </div>
            <Check size={24} />
          </div>
          {resultTarget === "interior" && (
            <p className="notice">本次结果仅含内页与上传说明，不包含封面，也不代表全书文件齐备。</p>
          )}
          {exportedSnapshot !== signature && (
            <p className="notice">
              书本或导出范围已发生变化。下面是之前快照与范围的文件，不代表当前选择已经导出。
            </p>
          )}
          <div className="file-links">
            {result.files.map((file) => (
              <a className="button" key={file.url} href={file.url} target="_blank" rel="noreferrer">
                <Download size={17} />
                {file.name}
                <ArrowUpRight size={14} />
              </a>
            ))}
          </div>
          {!result.files.length && (
            <p role="alert" className="notice error">
              服务未返回可下载文件，请检查服务端后重试。
            </p>
          )}
          {result.issues.length > 0 && (
            <details>
              <summary>本次导出检查记录 · {result.issues.length} 项</summary>
              <ul>
                {result.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      <p className="end-note">
        下一站：使用同一规格上传 KDP → 检查 Print Previewer → 建议订购纸质样书。
      </p>
    </div>
  );
}
