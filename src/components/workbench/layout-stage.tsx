import { useState } from "react";
import Image from "next/image";
import type { Book, BookPage } from "@/domain/book";
import {
  TEXT_COLORS,
  coverGeometry,
  effectiveDpi,
  selectedAsset,
  sizeLabel,
} from "@/domain/print-spec";
import { Field } from "./controls";
import { CoverPreview, PagePreview } from "./book-preview";
import { PageList, PageMetrics } from "./content-stage";
import { CoverCandidates, GenerateControls, JobPanel } from "./generation-stage";
import type { Workbench } from "./use-workbench";

export function LayoutStage({
  store,
  selectedId,
  select,
  tab,
  setTab,
}: {
  store: Workbench;
  selectedId: string;
  select: (id: string) => void;
  tab: "pages" | "cover";
  setTab: (tab: "pages" | "cover") => void;
}) {
  const [spread, setSpread] = useState(false);
  const book = store.book as Book;
  const index = book.pages.findIndex((page) => page.id === selectedId);
  const page = book.pages[index];
  const patchPage = (patch: Partial<BookPage>) =>
    store.edit((draft) => {
      Object.assign(draft.pages[index], patch);
    });
  const spreadSlots: ({ page: BookPage; index: number } | null)[] =
    index % 2 === 1
      ? [
          { page, index },
          book.pages[index + 1] ? { page: book.pages[index + 1], index: index + 1 } : null,
        ]
      : [
          book.pages[index - 1] ? { page: book.pages[index - 1], index: index - 1 } : null,
          { page, index },
        ];
  const cover = coverGeometry(book.config, book.pages.length);
  const coverAsset = selectedAsset(book.cover);
  return (
    <div className="stage-stack">
      <div className="tab-switch" role="group" aria-label="排版对象">
        <button aria-pressed={tab === "pages"} onClick={() => setTab("pages")}>
          内页排版
        </button>
        <button aria-pressed={tab === "cover"} onClick={() => setTab("cover")}>
          封面与封底
        </button>
      </div>
      {tab === "pages" ? (
        <section className="page-workspace">
          <PageList
            book={book}
            selectedId={selectedId}
            select={select}
            edit={store.edit}
            disabled={store.locked}
          />
          <div className="page-edit-area">
            {page ? (
              <>
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      第 {index + 1} 页 · {index % 2 ? "左页" : "右页"}
                    </span>
                    <h2>给文字和画面，恰好的空间</h2>
                  </div>
                </div>
                <div className="layout-editor">
                  <div className="preview-desk">
                    {spread ? (
                      <div className="spread-view" aria-label="左右跨页近似预览">
                        {spreadSlots.map((slot, position) => (
                          <div
                            className="spread-half"
                            key={slot ? slot.page.id : `empty-${position}`}
                          >
                            {slot ? (
                              <PagePreview
                                book={book}
                                page={slot.page}
                                index={slot.index}
                                guides={false}
                              />
                            ) : (
                              <div className="spread-empty">
                                {position === 0
                                  ? "第一页是右页；左侧属于封面内侧。"
                                  : "当前是全书最后一页，右侧暂无下一页。"}
                              </div>
                            )}
                            <span className="preview-caption">
                              {slot
                                ? `第 ${slot.index + 1} 页 · ${slot.index % 2 ? "左页" : "右页"}`
                                : "空"}
                            </span>
                          </div>
                        ))}
                        <div className="spread-spine" aria-hidden="true" />
                      </div>
                    ) : (
                      <PagePreview book={book} page={page} index={index} />
                    )}
                    <p className="preview-caption">虚线不进入 PDF · 预览仅近似，实际 PDF 为准</p>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={spread}
                        onChange={(event) => setSpread(event.target.checked)}
                      />
                      <span>左右跨页预览（模拟翻开效果）</span>
                    </label>
                    <PageMetrics book={book} page={page} index={index} />
                  </div>
                  <fieldset disabled={store.locked} className="form-stack layout-controls">
                    {page.kind === "blank" ? (
                      <p className="notice">明确留白页，不绘制文字与图片。</p>
                    ) : (
                      <>
                        {page.kind === "illustration" && (
                          <Field label="页面模板">
                            <select
                              value={page.layout}
                              onChange={(event) =>
                                patchPage({ layout: event.target.value as BookPage["layout"] })
                              }
                            >
                              <option value="caption">图文分区 · Caption</option>
                              <option value="full">整页画面 · Full</option>
                            </select>
                          </Field>
                        )}
                        <Field label={`字号 · ${page.fontSize} pt`}>
                          <input
                            type="range"
                            min={12}
                            max={48}
                            step={1}
                            value={page.fontSize}
                            onChange={(event) =>
                              patchPage({ fontSize: Number(event.target.value) })
                            }
                          />
                        </Field>
                        <Field label="文字颜色" hint="印刷安全深色系；最终效果以草稿 PDF 为准。">
                          <select
                            value={page.textColor}
                            onChange={(event) =>
                              patchPage({
                                textColor: event.target.value as BookPage["textColor"],
                              })
                            }
                          >
                            {Object.entries(TEXT_COLORS).map(([key, preset]) => (
                              <option key={key} value={key}>
                                {preset.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        {page.kind === "illustration" && (
                          <>
                            <Field
                              label={`图片缩放 · ${page.zoom.toFixed(2)}×`}
                              hint="放大会降低有效 DPI；不会增加真实像素。"
                            >
                              <input
                                type="range"
                                min={1}
                                max={3}
                                step={0.01}
                                value={page.zoom}
                                onChange={(event) =>
                                  patchPage({ zoom: Number(event.target.value) })
                                }
                              />
                            </Field>
                            <Field label={`水平位置 · ${Math.round(page.offsetX * 100)}%`}>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={page.offsetX}
                                onChange={(event) =>
                                  patchPage({ offsetX: Number(event.target.value) })
                                }
                              />
                            </Field>
                            <Field label={`垂直位置 · ${Math.round(page.offsetY * 100)}%`}>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={page.offsetY}
                                onChange={(event) =>
                                  patchPage({ offsetY: Number(event.target.value) })
                                }
                              />
                            </Field>
                            <button
                              className="button"
                              onClick={() => patchPage({ zoom: 1, offsetX: 0.5, offsetY: 0.5 })}
                            >
                              重置裁切
                            </button>
                            {page.selectedAssetId && !page.imageConfirmed && (
                              <button
                                className="button primary"
                                onClick={() => patchPage({ imageConfirmed: true })}
                              >
                                重新确认当前选图
                              </button>
                            )}
                          </>
                        )}
                        <p className="field-hint">
                          留意安全区、书脊侧与主体裁切。字体与行距的最终效果请用草稿 PDF 检查。
                        </p>
                      </>
                    )}
                  </fieldset>
                </div>
              </>
            ) : (
              <p className="notice">还没有内页。回到第一步，添加你的故事。</p>
            )}
          </div>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">一张完整的展开封面</span>
                <h2>从封底，到故事开始的地方</h2>
              </div>
              <span className="small-tag">{book.pages.length} 页联动</span>
            </div>
            <div className="cover-desk">
              <CoverPreview book={book} />
            </div>
            <div className="page-metrics">
              <span>展开尺寸 {sizeLabel(cover.width / 72, cover.height / 72)}</span>
              <span>
                书脊 {(cover.spine / 72).toFixed(4)} in（{(cover.spine * 0.352778).toFixed(2)} mm）
              </span>
              <span
                className={
                  coverAsset && effectiveDpi(coverAsset, cover.image) < 300 ? "warning-text" : ""
                }
              >
                封面有效 DPI：
                {coverAsset ? Math.floor(effectiveDpi(coverAsset, cover.image)) : "尚未选图"}
              </span>
            </div>
            <p className="preview-caption">
              左侧封底，右侧封面；条码区留空。预览仅近似，最终以 PDF 与 KDP 模板为准。
            </p>
            <fieldset disabled={store.locked} className="form-stack">
              <div className="field-pair">
                <Field label="封面书名">
                  <input
                    maxLength={200}
                    value={book.cover.title}
                    onChange={(event) =>
                      store.edit((draft) => {
                        draft.cover.title = event.target.value;
                      })
                    }
                  />
                </Field>
                <Field label="作者署名">
                  <input
                    maxLength={120}
                    value={book.cover.author}
                    onChange={(event) =>
                      store.edit((draft) => {
                        draft.cover.author = event.target.value;
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="封底简介">
                <textarea
                  maxLength={1500}
                  rows={3}
                  value={book.cover.description}
                  onChange={(event) =>
                    store.edit((draft) => {
                      draft.cover.description = event.target.value;
                    })
                  }
                />
              </Field>
              <Field
                label="封面插画提示词"
                hint="只描述画面；书名、作者和简介独立排版，不交给图像模型绘字。"
              >
                <textarea
                  maxLength={12000}
                  rows={3}
                  value={book.cover.prompt}
                  onChange={(event) =>
                    store.edit((draft) => {
                      draft.cover.prompt = event.target.value;
                    })
                  }
                />
              </Field>
              <Field label="封底与书脊背景色">
                <input
                  className="color-input"
                  type="color"
                  value={book.cover.background}
                  onChange={(event) =>
                    store.edit((draft) => {
                      draft.cover.background = event.target.value;
                    })
                  }
                />
              </Field>
            </fieldset>
          </section>
          <section className="panel">
            <h2>为封面选一幅画</h2>
            <GenerateControls store={store} targetIds={["cover"]} label="封面" />
            <div className="reuse-row">
              <span className="field-hint">复用内页已选插画（会加入封面候选并直接选用）：</span>
              {(() => {
                const reusable = book.pages.filter(
                  (item) => item.kind === "illustration" && item.selectedAssetId,
                );
                if (!reusable.length)
                  return <span className="field-hint">内页还没有已选插画。</span>;
                return reusable.map((item) => {
                  const pageNumber = book.pages.findIndex((entry) => entry.id === item.id) + 1;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="reuse-thumb"
                      disabled={store.locked}
                      title={`第 ${pageNumber} 页插画，点选用作封面`}
                      aria-label={`复用第 ${pageNumber} 页插画作为封面`}
                      onClick={() => void store.reuseAsset("cover", item.selectedAssetId!)}
                    >
                      <Image
                        unoptimized
                        src={`/api/assets/${item.selectedAssetId}`}
                        alt={`第 ${pageNumber} 页插画缩略图`}
                        width={52}
                        height={52}
                      />
                      <small>第 {pageNumber} 页</small>
                    </button>
                  );
                });
              })()}
            </div>
            <CoverCandidates store={store} />
          </section>
          <JobPanel store={store} />
        </>
      )}
    </div>
  );
}
