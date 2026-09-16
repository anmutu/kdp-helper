import { useState } from "react";
import Image from "next/image";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Plus,
  Trash2,
  WandSparkles,
} from "lucide-react";
import {
  newPage,
  styleAfterInkChange,
  type Book,
  type BookPage,
  type PrintConfig,
} from "@/domain/book";
import {
  alphabetPages,
  effectiveDpi,
  inkLabel,
  pageGeometry,
  pageRange,
  pixelRequirements,
  RULES,
  selectedAsset,
} from "@/domain/print-spec";
import { Field, Modal, UploadButton } from "./controls";
import { PagePreview } from "./book-preview";
import { movePage, type BookEdit } from "./ui-helpers";
import type { Workbench } from "./use-workbench";

export function TrimPresets({
  value,
  change,
}: {
  value: PrintConfig["trim"];
  change: (trim: PrintConfig["trim"]) => void;
}) {
  return (
    <div className="trim-presets" role="group" aria-label="成品尺寸预设">
      {Object.entries(RULES.trims).map(([key, trim]) => (
        <button
          key={key}
          type="button"
          className={`trim-option ${value === key ? "selected" : ""}`}
          aria-pressed={value === key}
          onClick={() => change(key as PrintConfig["trim"])}
        >
          <span
            className="trim-silhouette"
            style={{ aspectRatio: `${trim.width} / ${trim.height}` }}
          />
          <strong>{trim.label}</strong>
          <span>{key.replace("x", " × ")} 英寸</span>
        </button>
      ))}
    </div>
  );
}

export function SpecEditor({
  book,
  edit,
  disabled,
  saveState,
}: {
  book: Book;
  edit: (edit: BookEdit) => void;
  disabled: boolean;
  saveState: string;
}) {
  const range = pageRange(book.config);
  const update = (patch: Partial<PrintConfig>) =>
    edit((draft) => {
      draft.config = { ...draft.config, ...patch };
    });
  const changeInk = (ink: PrintConfig["ink"]) =>
    edit((draft) => {
      draft.config = {
        ...draft.config,
        ink,
        ...(ink !== "black" && draft.config.paper === "cream" ? { paper: "white" as const } : {}),
      };
      draft.style = styleAfterInkChange(ink, draft.style);
    });
  return (
    <section className="panel spec-panel" aria-labelledby="spec-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">先定下纸张的尺度</span>
          <h2 id="spec-heading">这本书，拿在手里是什么样？</h2>
        </div>
        <span className="small-tag">{inkLabel(book.config.ink)}平装</span>
      </div>
      <fieldset disabled={disabled}>
        <TrimPresets value={book.config.trim} change={(trim) => update({ trim })} />
        <div className="spec-options">
          <Field
            label="印刷方式"
            hint={
              book.config.ink === "black"
                ? "黑白印刷：默认画风会自动换成黑白插画，仍可自行修改。"
                : undefined
            }
          >
            <select
              value={book.config.ink}
              onChange={(event) => changeInk(event.target.value as PrintConfig["ink"])}
            >
              <option value="black">黑白 · Black &amp; White</option>
              <option value="premium">高级彩色 · Premium</option>
              <option value="standard">标准彩色 · Standard</option>
            </select>
          </Field>
          <Field
            label="纸张"
            hint={book.config.ink === "black" ? undefined : "彩色墨水仅提供白纸。"}
          >
            <select
              value={book.config.paper}
              disabled={book.config.ink !== "black"}
              onChange={(event) => update({ paper: event.target.value as PrintConfig["paper"] })}
            >
              <option value="white">白纸 · White paper</option>
              <option value="cream">米色纸 · Cream paper</option>
            </select>
          </Field>
          <Field label="页面边缘">
            <select
              value={book.config.bleed ? "bleed" : "none"}
              onChange={(event) => update({ bleed: event.target.value === "bleed" })}
            >
              <option value="none">无出血 · 保留纸边</option>
              <option value="bleed">有出血 · 画面到边</option>
            </select>
          </Field>
        </div>
        <div className="spec-facts">
          <span>
            内页{" "}
            <strong>
              {range.min}–{range.max} 页
            </strong>
            ，且必须为偶数
          </span>
          <span>
            图片至少 <strong>{RULES.dpi} DPI</strong>
          </span>
          <span>
            当前 <strong>{book.pages.length} 页</strong>
          </span>
        </div>
        <label className="check-row spec-confirm">
          <input
            type="checkbox"
            checked={book.specConfirmed}
            disabled={!book.specConfirmed && saveState !== "saved"}
            onChange={(event) =>
              edit((draft) => {
                draft.specConfirmed = event.target.checked;
              })
            }
          />
          <span>
            我已核对这本书的出版规格
            <span className="field-hint">
              变更规格后需先保存，再重新确认；未确认时不会调用生成接口。
            </span>
          </span>
        </label>
      </fieldset>
      <div className="source-line">
        <span>官方规则核对：{RULES.checkedAt}</span>
        <a href={RULES.manuscriptUrl} target="_blank" rel="noreferrer">
          内页规范 <ArrowUpRight size={12} />
        </a>
        <a href={RULES.coverUrl} target="_blank" rel="noreferrer">
          封面规范 <ArrowUpRight size={12} />
        </a>
        <a href={RULES.calculatorUrl} target="_blank" rel="noreferrer">
          封面计算器 <ArrowUpRight size={12} />
        </a>
      </div>
    </section>
  );
}

export function PageList({
  book,
  selectedId,
  select,
  edit,
  disabled,
}: {
  book: Book;
  selectedId: string;
  select: (id: string) => void;
  edit: (edit: BookEdit) => void;
  disabled: boolean;
}) {
  const add = (kind: BookPage["kind"]) => {
    const page = { ...newPage(), kind };
    edit((draft) => {
      draft.pages.push(page);
    });
    select(page.id);
  };
  return (
    <aside className="page-list" aria-label="页面清单">
      <div className="page-list-heading">
        <h3>内页清单</h3>
        <span>{book.pages.length} 页</span>
      </div>
      <div className="page-list-items">
        {book.pages.map((page, index) => (
          <button
            key={page.id}
            type="button"
            className={`page-item ${page.id === selectedId ? "selected" : ""}`}
            aria-current={page.id === selectedId ? "true" : undefined}
            onClick={() => select(page.id)}
          >
            <span className="page-number">{String(index + 1).padStart(2, "0")}</span>
            <span>
              <strong>{page.title || (page.kind === "blank" ? "留白页" : "未命名页")}</strong>
              <small>
                {index % 2 === 0 ? "右页" : "左页"} ·{" "}
                {page.kind === "blank"
                  ? "留白"
                  : page.kind === "text"
                    ? "文字"
                    : page.imageConfirmed
                      ? "已确认选图"
                      : page.selectedAssetId
                        ? "选图待确认"
                        : "待选图"}
              </small>
            </span>
          </button>
        ))}
      </div>
      <div className="page-list-actions">
        <button
          className="button"
          disabled={disabled || book.pages.length >= 828}
          onClick={() => add("illustration")}
        >
          <Plus size={15} />
          添加一页
        </button>
        <button
          className="button quiet"
          disabled={disabled || book.pages.length >= 828}
          onClick={() => add("blank")}
        >
          添加留白页
        </button>
      </div>
      {book.pages.length % 2 === 1 && (
        <p className="inline-warning">当前为奇数页。请明确添加留白页，不会自动补页。</p>
      )}
    </aside>
  );
}

export function PageMetrics({ book, page, index }: { book: Book; page: BookPage; index: number }) {
  const geometry = pageGeometry(book.config, book.pages.length, index, page.layout);
  const pixels = pixelRequirements(geometry.image);
  const asset = selectedAsset(page);
  const dpi = asset ? Math.floor(effectiveDpi(asset, geometry.image, page.zoom)) : null;
  return (
    <div className="page-metrics">
      <span>
        {(geometry.width / 72).toFixed(3)} × {(geometry.height / 72).toFixed(3)} in · 含所选出血
      </span>
      {page.kind === "illustration" && (
        <>
          <span>
            需 {pixels.width} × {pixels.height} px（300 DPI，缩放前）
          </span>
          <span className={dpi !== null && dpi < 300 ? "warning-text" : ""}>
            有效 DPI：{dpi ?? "尚未选图"}
            {asset && ` · 原图 ${asset.width} × ${asset.height} px`}
          </span>
        </>
      )}
    </div>
  );
}

export function ContentStage({
  store,
  selectedId,
  select,
}: {
  store: Workbench;
  selectedId: string;
  select: (id: string) => void;
}) {
  const { book, edit, locked } = store;
  const [outline, setOutline] = useState<BookPage[] | null>(null);
  const [targetPages, setTargetPages] = useState(() => {
    const current = store.book?.pages.length || 32;
    return Math.min(60, Math.max(4, Math.ceil(current / 2) * 2));
  });
  if (!book) return null;
  const index = book.pages.findIndex((page) => page.id === selectedId);
  const page = book.pages[index];
  const patchPage = (patch: Partial<BookPage>) =>
    edit((draft) => {
      Object.assign(draft.pages[index], patch);
    });
  async function requestOutline() {
    if (
      !window.confirm(
        `将调用文字模型按目标 ${targetPages} 页（偶数）整理候选草稿，费用未知。不会自动替换现有内页。是否继续？`,
      )
    )
      return;
    const pages = await store.outline(targetPages);
    if (pages) setOutline(pages);
  }
  return (
    <div className="stage-stack">
      <SpecEditor book={book} edit={edit} disabled={locked} saveState={store.saveState} />
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">故事从你开始</span>
            <h2>内容与画风</h2>
          </div>
          <BookOpen size={23} strokeWidth={1.5} />
        </div>
        <fieldset disabled={locked} className="form-stack">
          <Field label="绘本名称">
            <input
              maxLength={200}
              required
              value={book.name}
              onChange={(event) =>
                edit((draft) => {
                  draft.name = event.target.value;
                })
              }
            />
          </Field>
          <Field label="主题与故事想法">
            <textarea
              rows={3}
              maxLength={5000}
              value={book.theme}
              placeholder="例如：跟着一只小狐狸，认识森林里从 A 到 Z 的动物。"
              onChange={(event) =>
                edit((draft) => {
                  draft.theme = event.target.value;
                })
              }
            />
          </Field>
          <div className="field-pair">
            <Field label="出版语言">
              <input
                maxLength={80}
                value={book.language}
                onChange={(event) =>
                  edit((draft) => {
                    draft.language = event.target.value;
                  })
                }
              />
            </Field>
            <Field label="目标读者">
              <input
                maxLength={200}
                value={book.audience}
                onChange={(event) =>
                  edit((draft) => {
                    draft.audience = event.target.value;
                  })
                }
              />
            </Field>
          </div>
          <Field
            label="整本画风"
            hint="画风或参考图变更后，已有选图需要重新确认。图片内不生成文字，书中文字独立排版。"
          >
            <textarea
              rows={3}
              maxLength={5000}
              value={book.style}
              onChange={(event) =>
                edit((draft) => {
                  draft.style = event.target.value;
                })
              }
            />
          </Field>
          <div className="reference-row">
            <UploadButton
              label={book.referenceAssetId ? "更换参考图" : "导入参考图（可选）"}
              disabled={locked}
              onUpload={(file) => void store.upload(file, "reference")}
            />
            {book.referenceAssetId && (
              <>
                <Image
                  className="reference-thumbnail"
                  unoptimized
                  src={`/api/assets/${book.referenceAssetId}`}
                  alt="整本绘本的画风参考"
                  width={64}
                  height={64}
                />
                <button
                  className="button quiet"
                  onClick={() =>
                    edit((draft) => {
                      draft.referenceAssetId = null;
                    })
                  }
                >
                  移除参考图
                </button>
              </>
            )}
            <span className="field-hint">是否发送参考图由模型设置决定。</span>
          </div>
        </fieldset>
        <div className="template-row">
          <div>
            <h3>不必从空白开始</h3>
            <p>32 页 A–Z 动物模板只是示例。第 2 页版权文字是草稿，必须改为真实声明。</p>
          </div>
          <div className="button-row">
            <Field label="目标页数" hint="文字模型按此页数起草，必须是偶数。">
              <input
                type="number"
                min={4}
                max={60}
                step={2}
                value={targetPages}
                onChange={(event) =>
                  setTargetPages(Math.min(60, Math.max(4, Number(event.target.value) || 4)))
                }
              />
            </Field>
            <button
              className="button"
              disabled={locked}
              onClick={() => {
                if (
                  book.pages.length &&
                  !window.confirm("使用 32 页示例会替换当前全部内页及其选图，是否继续？")
                )
                  return;
                const pages = alphabetPages();
                edit((draft) => {
                  draft.pages = pages;
                });
                select(pages[0].id);
              }}
            >
              使用 A–Z 示例 · 32 页
            </button>
            <button
              className="button quiet"
              disabled={locked || !book.specConfirmed}
              onClick={() => void requestOutline()}
            >
              <WandSparkles size={15} />
              文字模型辅助（可选）
            </button>
          </div>
        </div>
      </section>
      <section className="page-workspace">
        <PageList
          book={book}
          selectedId={selectedId}
          select={select}
          edit={edit}
          disabled={locked}
        />
        {page ? (
          <div className="page-edit-area">
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  第 {index + 1} 页 · {index % 2 === 0 ? "右手页" : "左手页"}
                </span>
                <h2>一页一页，把故事写好</h2>
              </div>
              <div className="button-row">
                <button
                  className="icon-button"
                  aria-label="此页前移"
                  disabled={locked || index === 0}
                  onClick={() =>
                    edit((draft) => {
                      draft.pages = movePage(draft.pages, page.id, -1);
                    })
                  }
                >
                  <ArrowUp size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label="此页后移"
                  disabled={locked || index === book.pages.length - 1}
                  onClick={() =>
                    edit((draft) => {
                      draft.pages = movePage(draft.pages, page.id, 1);
                    })
                  }
                >
                  <ArrowDown size={17} />
                </button>
                <button
                  className="icon-button danger"
                  aria-label="删除此页"
                  disabled={locked}
                  onClick={() => {
                    if (window.confirm(`删除第 ${index + 1} 页？该页内容和候选关联将移除。`)) {
                      edit((draft) => {
                        draft.pages = draft.pages.filter((item) => item.id !== page.id);
                      });
                      select(book.pages[index + 1]?.id || book.pages[index - 1]?.id || "");
                    }
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
            <div className="editor-preview">
              <fieldset disabled={locked} className="form-stack">
                <Field label="页面类型">
                  <select
                    value={page.kind}
                    onChange={(event) =>
                      patchPage({ kind: event.target.value as BookPage["kind"] })
                    }
                  >
                    <option value="illustration">图文页</option>
                    <option value="text">纯文字页</option>
                    <option value="blank">明确留白页</option>
                  </select>
                </Field>
                {page.kind !== "blank" && (
                  <>
                    <Field label="页标题">
                      <input
                        maxLength={200}
                        value={page.title}
                        onChange={(event) => patchPage({ title: event.target.value })}
                      />
                    </Field>
                    <Field label="页面文字" hint="可以完全手工编写，不需要配置文字模型。">
                      <textarea
                        rows={6}
                        maxLength={3000}
                        value={page.text}
                        onChange={(event) => patchPage({ text: event.target.value })}
                      />
                    </Field>
                    {page.kind === "illustration" && (
                      <Field label="这一页的插画提示词">
                        <textarea
                          rows={4}
                          maxLength={12000}
                          value={page.prompt}
                          placeholder="描述角色、动作、场景；不要要求模型在图内写字。"
                          onChange={(event) => patchPage({ prompt: event.target.value })}
                        />
                      </Field>
                    )}
                  </>
                )}
                {page.kind === "blank" && (
                  <p className="notice">此页会以空白页导出，计入内页总数与书脊厚度。</p>
                )}
              </fieldset>
              <div className="preview-desk">
                <PagePreview book={book} page={page} index={index} />
                <p className="preview-caption">虚线为安全区 · 屏幕仅近似，实际 PDF 为准</p>
                <PageMetrics book={book} page={page} index={index} />
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-pages">
            <BookOpen size={42} strokeWidth={1} />
            <h2>第一页，留给你的想法</h2>
            <p>添加内页，或从上方 32 页示例开始。所有文字都可以自己写。</p>
          </div>
        )}
      </section>
      {outline && (
        <Modal title="先看看文字草稿" close={() => setOutline(null)}>
          <p className="notice">
            共 {outline.length} 页。只有点击“替换内页”才会覆盖当前内页；请特别修改版权声明。
          </p>
          {outline.length % 2 === 1 && (
            <p className="inline-warning">
              草稿为奇数页；替换后请补一页留白，否则正式导出会被阻止。
            </p>
          )}
          <div className="outline-list">
            {outline.map((item, position) => (
              <article key={item.id}>
                <h3>
                  {position + 1}. {item.title || "未命名页"}
                </h3>
                <p>{item.text}</p>
                <small>{item.prompt}</small>
              </article>
            ))}
          </div>
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={locked}
              onClick={() => {
                if (!window.confirm("确认用这些草稿替换全部当前内页？原内页选图不会保留。")) return;
                edit((draft) => {
                  draft.pages = outline;
                });
                select(outline[0]?.id || "");
                setOutline(null);
              }}
            >
              确认并替换内页
            </button>
            <button className="button" onClick={() => setOutline(null)}>
              保留原稿
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
