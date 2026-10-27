import { useState } from "react";
import Image from "next/image";
import { Check, CircleCheck, ImagePlus, Pause, Sparkles, Trash2, ZoomIn } from "lucide-react";
import type { Asset, Book, BookPage, Cover, Job, Rect } from "@/domain/book";
import {
  coverGeometry,
  effectiveDpi,
  pageGeometry,
  pixelRequirements,
  selectedAsset,
} from "@/domain/print-spec";
import { Field, Modal, UploadButton } from "./controls";
import { StageWhy } from "./onboarding";
import { PageList, PageMetrics } from "./content-stage";
import { generationTargets, jobIsInFlight } from "./ui-helpers";
import type { Workbench } from "./use-workbench";

function CandidateLightbox({
  asset,
  index,
  rect,
  zoom,
  disabled,
  choose,
  close,
}: {
  asset: Asset;
  index: number;
  rect: Rect;
  zoom: number;
  disabled: boolean;
  choose: (id: string) => void;
  close: () => void;
}) {
  const dpi = Math.floor(effectiveDpi(asset, rect, zoom));
  return (
    <Modal title={`候选 ${String(index + 1).padStart(2, "0")} · 大图查看`} close={close}>
      <div className="lightbox">
        <Image
          unoptimized
          src={`/api/assets/${asset.id}`}
          alt={`候选插画 ${index + 1} 大图`}
          width={asset.width}
          height={asset.height}
          className="lightbox-image"
        />
        <div className="page-metrics">
          <span>
            实际 {asset.width} × {asset.height} px
          </span>
          <span className={dpi < 300 ? "warning-text" : "success"}>当前版式有效 DPI：{dpi}</span>
          <span>
            {asset.source === "import"
              ? "手工导入"
              : `模型生成${asset.model ? ` · ${asset.model}` : ""}`}
          </span>
          <span>时间 {new Date(asset.createdAt).toLocaleString()}</span>
        </div>
        {asset.prompt && <p className="field-hint lightbox-prompt">提示词：{asset.prompt}</p>}
        <div className="modal-actions">
          <button
            className="button primary"
            disabled={disabled}
            onClick={() => {
              choose(asset.id);
              close();
            }}
          >
            选用这张
          </button>
          <button className="button" onClick={close}>
            关闭
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function CandidatePicker({
  target,
  rect,
  zoom = 1,
  disabled,
  choose,
  confirm,
  upload,
  remove,
}: {
  target: BookPage | Cover;
  rect: Rect;
  zoom?: number;
  disabled: boolean;
  choose: (id: string) => void;
  confirm: () => void;
  upload: (file: File) => void;
  remove: (assetId: string) => void;
}) {
  const chosen = selectedAsset(target);
  const pixels = pixelRequirements(rect);
  const [preview, setPreview] = useState<{ asset: Asset; index: number } | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const compareAssets = compareIds
    .map((id) => target.candidates.find((asset) => asset.id === id))
    .filter((asset): asset is Asset => !!asset);
  const toggleCompare = (id: string) =>
    setCompareIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : current.length >= 3
          ? current
          : [...current, id],
    );
  return (
    <section className="candidate-section">
      <div className="section-heading">
        <div>
          <h3>
            候选图片 <span className="muted">{target.candidates.length}</span>
          </h3>
          <p className="field-hint">导入或生成只会添加候选。点击图片选用后，再检查最终效果。</p>
        </div>
        <UploadButton disabled={disabled} onUpload={upload} />
      </div>
      <p className="candidate-requirement">
        当前画框至少需要 {pixels.width} × {pixels.height} px；缩放裁切后还需达到 300 DPI。
      </p>
      {target.candidates.length > 1 && (
        <div className="compare-bar">
          <label className="check-row">
            <input
              type="checkbox"
              checked={compareMode}
              onChange={(event) => {
                setCompareMode(event.target.checked);
                setCompareIds([]);
              }}
            />
            <span>对比模式（勾选 2–3 张并排比较）</span>
          </label>
          {compareMode && compareIds.length >= 2 && (
            <button type="button" className="button" onClick={() => setCompareOpen(true)}>
              并排对比 {compareIds.length} 张
            </button>
          )}
        </div>
      )}
      {target.candidates.length ? (
        <div className="candidate-grid">
          {target.candidates.map((asset, index) => {
            const dpi = Math.floor(effectiveDpi(asset, rect, zoom));
            const selected = target.selectedAssetId === asset.id;
            const inCompare = compareIds.includes(asset.id);
            return (
              <div
                className={`candidate ${selected ? "selected" : ""} ${inCompare ? "in-compare" : ""}`}
                key={asset.id}
              >
                <button
                  type="button"
                  className="candidate-choose"
                  disabled={disabled}
                  aria-pressed={selected}
                  aria-label={`选用候选 ${index + 1}，${asset.width} 乘 ${asset.height} 像素，${dpi} DPI`}
                  onClick={() => choose(asset.id)}
                >
                  <div className="candidate-image">
                    <Image
                      unoptimized
                      src={`/api/assets/${asset.id}`}
                      alt={`候选插画 ${index + 1}`}
                      width={asset.width}
                      height={asset.height}
                    />
                    {selected && (
                      <span className="selection-mark">
                        <Check size={16} />
                        已选用
                      </span>
                    )}
                  </div>
                  <div className="candidate-caption">
                    <strong>方案 {String(index + 1).padStart(2, "0")}</strong>
                    <span className={dpi < 300 ? "warning-text" : "success"}>
                      {dpi} DPI{dpi < 300 ? " · 仅草稿" : ""}
                    </span>
                    <small>
                      {asset.width} × {asset.height} px ·{" "}
                      {asset.source === "import" ? "手工导入" : "模型生成"}
                    </small>
                  </div>
                </button>
                {compareMode ? (
                  <label className="candidate-compare-check" title="加入对比">
                    <input
                      type="checkbox"
                      checked={inCompare}
                      onChange={() => toggleCompare(asset.id)}
                    />
                    对比
                  </label>
                ) : null}
                <button
                  type="button"
                  className="candidate-zoom"
                  aria-label={`放大查看候选 ${index + 1}`}
                  onClick={() => setPreview({ asset, index })}
                >
                  <ZoomIn size={16} />
                </button>
                <button
                  type="button"
                  className="candidate-zoom candidate-delete"
                  aria-label={`删除候选 ${index + 1}`}
                  disabled={disabled}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `删除候选 ${index + 1}？${
                          selected
                            ? "它当前已被选用，删除后此页需要重新选图。"
                            : "将同时删除本机图片文件，不可恢复。"
                        }`,
                      )
                    )
                      return;
                    setPreview((current) => (current?.asset.id === asset.id ? null : current));
                    remove(asset.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="candidate-empty">
          <ImagePlus size={32} strokeWidth={1} />
          <h3>先有候选，再做选择</h3>
          <p>可以生成图片，也可以直接导入自己的 PNG / JPEG。</p>
          <p>
            还没有 API Key？到左侧「连接与模型设置」填好即可生图；或者一直用导入图片，无需任何配置。
          </p>
        </div>
      )}
      {chosen && (
        <div className={`selection-review ${target.imageConfirmed ? "confirmed" : ""}`}>
          <CircleCheck size={19} />
          <span>
            {target.imageConfirmed
              ? "已确认当前选图。仍请检查主体、细节和权利。"
              : "提示词或画风已变更，请重新核对并确认当前选图。"}
          </span>
          {!target.imageConfirmed && (
            <button className="button" disabled={disabled} onClick={confirm}>
              重新确认选图
            </button>
          )}
        </div>
      )}
      {preview && (
        <CandidateLightbox
          asset={preview.asset}
          index={preview.index}
          rect={rect}
          zoom={zoom}
          disabled={disabled}
          choose={choose}
          close={() => setPreview(null)}
        />
      )}
      {compareOpen && compareAssets.length >= 2 && (
        <Modal
          title={`并排对比 · ${compareAssets.length} 张候选`}
          close={() => setCompareOpen(false)}
        >
          <div className="compare-grid">
            {compareAssets.map((asset) => {
              const dpi = Math.floor(effectiveDpi(asset, rect, zoom));
              const index = target.candidates.findIndex((entry) => entry.id === asset.id);
              return (
                <figure className="compare-column" key={asset.id}>
                  <Image
                    unoptimized
                    src={`/api/assets/${asset.id}`}
                    alt={`对比候选 ${index + 1}`}
                    width={asset.width}
                    height={asset.height}
                    className="compare-image"
                  />
                  <figcaption className="page-metrics">
                    <span>方案 {String(index + 1).padStart(2, "0")}</span>
                    <span className={dpi < 300 ? "warning-text" : "success"}>{dpi} DPI</span>
                    <span>
                      {asset.width} × {asset.height} px
                    </span>
                  </figcaption>
                  <button
                    type="button"
                    className="button primary"
                    disabled={disabled}
                    onClick={() => {
                      choose(asset.id);
                      setCompareOpen(false);
                    }}
                  >
                    选用这张
                  </button>
                </figure>
              );
            })}
          </div>
        </Modal>
      )}
    </section>
  );
}

export function GenerateControls({
  store,
  targetIds,
  label,
}: {
  store: Workbench;
  targetIds: string[];
  label: string;
}) {
  const [count, setCount] = useState(1);
  const [sample, setSample] = useState(false);
  const book = store.book;
  if (!book) return null;
  const total = targetIds.length * count;
  const overLimit = targetIds.length > 64 || total > 128;
  const requiresStyleConfirmation = !sample && (targetIds.length > 1 || count > 1);
  const generate = () => {
    if (!total || overLimit) return;
    if (
      !window.confirm(
        `${sample ? "仅低清试画（不能直接印刷）" : "印刷图生成（服务端将先检查请求尺寸）"}\n${label}：${targetIds.length} 个目标 × ${count} 张 = ${total} 张。\n费用未知，按已配置服务实际计费。是否提交？`,
      )
    )
      return;
    void store.generate(targetIds, count, sample);
  };
  return (
    <fieldset disabled={store.locked} className="generation-controls">
      <div className="field-pair">
        <Field label="每个目标的候选数">
          <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
            {[1, 2, 3, 4].map((number) => (
              <option key={number} value={number}>
                {number} 张
              </option>
            ))}
          </select>
        </Field>
        <div className="generation-total">
          <span>{sample ? "低清试画" : "印刷图"}</span>
          <strong>
            {total} <small>张候选</small>
          </strong>
        </div>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={sample}
          onChange={(event) => setSample(event.target.checked)}
        />
        <span>
          仅低清试画（不能直接印刷）
          <span className="field-hint">
            用于先验证画风。默认 1024 × 1024
            通常不足印刷尺寸；未勾选时，尺寸不足会在付费调用前被拒绝。
          </span>
        </span>
      </label>
      <p className="field-hint">
        若提交响应丢失，请保持同一本书、相同目标页、张数与试画设置，手动重试将复用已保存在本机的请求编号；刷新页面也不会丢失。不会自动重试，修改这些参数会创建独立请求。
      </p>
      <div className="generate-action">
        <button
          type="button"
          className="button primary"
          disabled={
            store.locked ||
            !book.specConfirmed ||
            (requiresStyleConfirmation && !book.generationStyleConfirmed) ||
            total === 0 ||
            overLimit
          }
          onClick={generate}
        >
          <Sparkles size={17} />
          {store.busy === "正在提交生图任务…"
            ? "正在提交…"
            : `生成${sample ? "低清试画" : "印刷候选"}`}{" "}
          · {total} 张
        </button>
        <span className="field-hint">费用未知 · 点击后还需确认</span>
      </div>
      {overLimit && (
        <p className="inline-warning">
          单次最多 64 个目标、128 张候选。请减少每页张数，或选择“仅当前图文页”逐页处理。
        </p>
      )}
      {!book.specConfirmed && <p className="inline-warning">请回到第一步保存并确认出版规格。</p>}
      {requiresStyleConfirmation && !book.generationStyleConfirmed && (
        <p className="inline-warning">
          批量生成印刷图前，请先生成并选中一张样张，再确认当前画风方向。
        </p>
      )}
    </fieldset>
  );
}

const jobLabels: Record<Job["status"], string> = {
  queued: "排队中",
  running: "生成中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  unknown: "状态未知",
};

export function JobPanel({ store }: { store: Workbench }) {
  if (!store.jobs.length) return null;
  return (
    <section className="job-panel" aria-label="生成任务">
      <h3>任务记录</h3>
      {store.jobs.slice(0, 6).map((job) => {
        const completed = job.items.filter((item) => item.status === "completed").length;
        const active = jobIsInFlight(job);
        return (
          <article className="job" key={job.id}>
            <div className="job-title">
              <strong>{jobLabels[job.status]}</strong>
              <span>
                {completed} / {job.items.length} 张完成
              </span>
              {active && (
                <button
                  className="button quiet"
                  disabled={!!store.busy || store.conflict}
                  onClick={() => void store.pause(job.id)}
                >
                  <Pause size={14} />
                  暂停后续生成
                </button>
              )}
            </div>
            <progress aria-label="生成进度" max={Math.max(job.items.length, 1)} value={completed} />
            <p className="field-hint">
              {job.message ||
                (active
                  ? "生成期间暂时锁定书本编辑，候选会自动刷新。暂停不会取消已发送的请求。"
                  : "候选保留在对应页面，需由你选择。")}
            </p>
            {job.items.some((item) => item.status === "failed" || item.status === "unknown") && (
              <details>
                <summary>查看未完成项目</summary>
                {job.items
                  .filter((item) => item.status === "failed" || item.status === "unknown")
                  .map((item, index) => (
                    <p className="inline-warning" key={`${item.targetId}-${index}`}>
                      {item.targetId === "cover"
                        ? "封面"
                        : `第 ${(store.book?.pages.findIndex((page) => page.id === item.targetId) ?? -1) + 1} 页`}
                      ：{item.message || "未确认成功；请检查候选后手动重试，避免重复计费。"}
                    </p>
                  ))}
              </details>
            )}
          </article>
        );
      })}
    </section>
  );
}

export function GenerationStage({
  store,
  selectedId,
  select,
}: {
  store: Workbench;
  selectedId: string;
  select: (id: string) => void;
}) {
  const [batch, setBatch] = useState<"current" | "missing" | "all">("current");
  const book = store.book as Book;
  const index = book.pages.findIndex((page) => page.id === selectedId);
  const page = book.pages[index];
  const targets =
    batch === "current"
      ? page?.kind === "illustration"
        ? [page.id]
        : []
      : generationTargets(book, batch);
  const hasSelectedSample =
    Boolean(book.cover.selectedAssetId) ||
    book.pages.some((candidate) => candidate.kind === "illustration" && candidate.selectedAssetId);
  return (
    <div className="stage-stack">
      <StageWhy>
        为什么生成前有这么多确认？插画是按张付费的：先用「仅低清试画」花小钱定画风，满意后再批量出印刷图；请求尺寸不够
        300 DPI 会被直接拦下、不发起付费调用，某张结果低了整批暂停——都是为了不白花钱。
      </StageWhy>
      <div className="notice">
        你决定用哪一张。低清试画和印刷图使用同一个候选区，实际像素与有效 DPI 始终可见。
      </div>
      <section className="page-workspace">
        <PageList
          book={book}
          selectedId={selectedId}
          select={select}
          edit={store.edit}
          disabled={store.locked}
        />
        <div className="page-edit-area">
          <div className="section-heading">
            <div>
              <span className="eyebrow">选图工作台</span>
              <h2>
                {page ? `第 ${index + 1} 页 · ${page.title || "未命名页"}` : "先在第一步添加内页"}
              </h2>
            </div>
          </div>
          <fieldset disabled={store.locked}>
            <Field label="本次生成范围">
              <select
                value={batch}
                onChange={(event) => setBatch(event.target.value as typeof batch)}
              >
                <option value="current">仅当前图文页</option>
                <option value="missing">所有尚未选图的图文页</option>
                <option value="all">全部图文页（增加候选）</option>
              </select>
            </Field>
          </fieldset>
          <GenerateControls
            store={store}
            targetIds={targets}
            label={
              batch === "current"
                ? "当前页"
                : batch === "missing"
                  ? "尚未选图的内页"
                  : "全部图文内页"
            }
          />
          <section
            className="panel style-confirmation"
            aria-labelledby="style-confirmation-heading"
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">先锁定视觉方向</span>
                <h3 id="style-confirmation-heading">确认当前画风方向</h3>
              </div>
              <Check size={20} strokeWidth={1.7} />
            </div>
            <p className="field-hint">
              先生成低清试画，选中一张最符合预期的候选，再确认画风。确认后才允许批量生成印刷图；修改规格、画风或参考图会自动要求重新确认。
            </p>
            <div className="generate-action">
              <button
                type="button"
                className="button"
                disabled={store.locked || book.generationStyleConfirmed || !hasSelectedSample}
                onClick={() =>
                  store.edit((draft) => {
                    draft.generationStyleConfirmed = true;
                  })
                }
              >
                {book.generationStyleConfirmed ? "已确认当前画风" : "确认并允许批量生成"}
              </button>
              {!hasSelectedSample && !book.generationStyleConfirmed && (
                <span className="field-hint">请先在候选区选中一张样张。</span>
              )}
            </div>
          </section>
          {page?.kind === "illustration" ? (
            <>
              <fieldset disabled={store.locked}>
                <Field label="当前页插画提示词">
                  <textarea
                    rows={3}
                    maxLength={12000}
                    value={page.prompt}
                    onChange={(event) =>
                      store.edit((draft) => {
                        draft.pages[index].prompt = event.target.value;
                      })
                    }
                  />
                </Field>
              </fieldset>
              <PageMetrics book={book} page={page} index={index} />
              <CandidatePicker
                target={page}
                rect={pageGeometry(book.config, book.pages.length, index, page.layout).image}
                zoom={page.zoom}
                disabled={store.locked}
                upload={(file) => void store.upload(file, page.id)}
                remove={(assetId) => void store.removeCandidate(page.id, assetId)}
                choose={(id) =>
                  store.edit((draft) => {
                    draft.pages[index].selectedAssetId = id;
                    draft.pages[index].imageConfirmed = true;
                  })
                }
                confirm={() =>
                  store.edit((draft) => {
                    draft.pages[index].imageConfirmed = true;
                  })
                }
              />
            </>
          ) : (
            <p className="notice">
              {page
                ? "文字页和留白页不需要图片。可选择其他图文页，或批量生成内页。"
                : "当前没有内页；生成封面请前往第三步。"}
            </p>
          )}
        </div>
      </section>
      <JobPanel store={store} />
    </div>
  );
}

export function CoverCandidates({ store }: { store: Workbench }) {
  const book = store.book as Book;
  return (
    <CandidatePicker
      target={book.cover}
      rect={coverGeometry(book.config, book.pages.length).image}
      disabled={store.locked}
      upload={(file) => void store.upload(file, "cover")}
      remove={(assetId) => void store.removeCandidate("cover", assetId)}
      choose={(id) =>
        store.edit((draft) => {
          draft.cover.selectedAssetId = id;
          draft.cover.imageConfirmed = true;
        })
      }
      confirm={() =>
        store.edit((draft) => {
          draft.cover.imageConfirmed = true;
        })
      }
    />
  );
}
