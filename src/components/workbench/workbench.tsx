"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  Download,
  FileCheck2,
  LayoutTemplate,
  Leaf,
  LoaderCircle,
  Plus,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import type { PrintConfig } from "@/domain/book";
import { styleAfterInkChange } from "@/domain/book";
import { inkLabel, paperLabel, RULES } from "@/domain/print-spec";
import { ContentStage, TrimPresets } from "./content-stage";
import { GenerationStage } from "./generation-stage";
import { LayoutStage } from "./layout-stage";
import { ExportStage } from "./export-stage";
import { Field, Modal } from "./controls";
import { SettingsDialog } from "./settings-dialog";
import { downloadDraft, jobIsInFlight } from "./ui-helpers";
import { useWorkbench } from "./use-workbench";

const stages = [
  {
    title: "规格与内容",
    subtitle: "定下纸张，写下故事",
    icon: BookOpen,
    heading: "从一个想法，到一本书。",
    description: "先确定印刷规格，再慢慢写好每一页。你始终是这本书的作者。",
  },
  {
    title: "生成与选图",
    subtitle: "让故事有自己的模样",
    icon: Sparkles,
    heading: "让故事，长出画面。",
    description: "先试一页，找到画风；再逐页挑选。候选不是定稿，你的选择才是。",
  },
  {
    title: "排版与封面",
    subtitle: "照顾每一处留白",
    icon: LayoutTemplate,
    heading: "把想象，安放在纸上。",
    description: "调整文字与画面的呼吸，也为这段故事做好封面。",
  },
  {
    title: "检查与导出",
    subtitle: "准备好，交给印刷",
    icon: FileCheck2,
    heading: "一本书，快要成形了。",
    description: "先导出草稿检查，再确认内容与权利，制作真正的出版文件。",
  },
];

function NewBookSpecFields({
  ink,
  paper,
  bleed,
  onInk,
  onPaper,
  onBleed,
}: {
  ink: PrintConfig["ink"];
  paper: PrintConfig["paper"];
  bleed: boolean;
  onInk: (ink: PrintConfig["ink"]) => void;
  onPaper: (paper: PrintConfig["paper"]) => void;
  onBleed: (bleed: boolean) => void;
}) {
  return (
    <>
      <Field label="印刷方式">
        <select
          value={ink}
          onChange={(event) => {
            const next = event.target.value as PrintConfig["ink"];
            onInk(next);
            if (next !== "black") onPaper("white");
          }}
        >
          <option value="black">黑白 · Black &amp; White</option>
          <option value="premium">高级彩色 · Premium</option>
          <option value="standard">标准彩色 · Standard</option>
        </select>
      </Field>
      <Field label="纸张" hint={ink === "black" ? undefined : "彩色墨水仅提供白纸。"}>
        <select
          value={paper}
          disabled={ink !== "black"}
          onChange={(event) => onPaper(event.target.value as PrintConfig["paper"])}
        >
          <option value="white">白纸 · White paper</option>
          <option value="cream">米色纸 · Cream paper</option>
        </select>
      </Field>
      <Field label="页面边缘">
        <select
          value={bleed ? "bleed" : "none"}
          onChange={(event) => onBleed(event.target.value === "bleed")}
        >
          <option value="none">无出血 · 保留纸边</option>
          <option value="bleed">有出血 · 画面到边</option>
        </select>
      </Field>
    </>
  );
}

export default function Workbench() {
  const store = useWorkbench();
  const [stage, setStage] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [trim, setTrim] = useState<PrintConfig["trim"]>("8.5x8.5");
  const [ink, setInk] = useState<PrintConfig["ink"]>("premium");
  const [paper, setPaper] = useState<PrintConfig["paper"]>("white");
  const [bleed, setBleed] = useState(false);
  const { book } = store;
  const selectedPage = book?.pages.some((page) => page.id === selectedId)
    ? selectedId
    : book?.pages[0]?.id || "";
  const activeJobs = store.jobs.some(jobIsInFlight);
  const statusLabel = store.conflict
    ? "版本冲突 · 本地修改已保留"
    : store.saveState === "saved"
      ? "已保存到本机"
      : store.saveState === "saving"
        ? "正在保存…"
        : store.saveState === "pending"
          ? "等待自动保存…"
          : "保存失败 · 修改仍在本页";
  async function create() {
    if (!name.trim()) return;
    const created = await store.create(name.trim());
    if (!created) return;
    store.edit((draft) => {
      draft.config = { trim, ink, bleed, paper };
      draft.style = styleAfterInkChange(ink, draft.style);
    });
    setNewOpen(false);
    setStage(0);
    setName("");
  }
  function navigate(next: number) {
    setStage(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  return (
    <div className="workbench-shell">
      <a className="skip-link" href="#workbench-main">
        跳到工作区
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol">
            <Leaf size={25} strokeWidth={1.4} />
          </span>
          <div>
            <strong>纸间</strong>
            <span>KDP 绘本工作台</span>
          </div>
        </div>
        <div className="sidebar-rule" />
        <p className="sidebar-label">一本书的诞生</p>
        <nav aria-label="制作步骤">
          {stages.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.title}
                className={`step-link ${stage === index ? "current" : ""}`}
                aria-current={stage === index ? "step" : undefined}
                disabled={!book && index > 0}
                onClick={() => navigate(index)}
              >
                <span className="step-icon">
                  <Icon size={19} strokeWidth={1.6} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                <span className="step-index">0{index + 1}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="status-dot" />
            <span>你的故事，保存在本机</span>
          </div>
          <button className="settings-button" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={18} />
            连接与模型设置
          </button>
          <span className="sidebar-footnote">
            作者的印刷工作台
            <br />
            少一点繁琐，多一点创作。
          </span>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="project-controls">
            <span className="topbar-label">当前绘本</span>
            {book ? (
              <select
                aria-label="切换绘本"
                value={book.id}
                disabled={store.locked}
                onChange={(event) => {
                  setSelectedId("");
                  void store.open(event.target.value);
                }}
              >
                {store.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name || "未命名绘本"}
                  </option>
                ))}
              </select>
            ) : (
              <strong>新的创作</strong>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="新建绘本"
              disabled={store.locked}
              onClick={() => setNewOpen(true)}
            >
              <Plus size={18} />
            </button>
          </div>
          <div
            className={`save-status ${store.saveState === "error" || store.conflict ? "warning-text" : ""}`}
            role="status"
          >
            {store.busy || store.saveState === "saving" ? (
              <LoaderCircle className="spinner" size={15} />
            ) : store.saveState === "saved" ? (
              <Check size={15} />
            ) : (
              <span className="status-dot" />
            )}
            <span>
              {store.loading
                ? "正在打开本地书架…"
                : store.busy || (book ? statusLabel : "本地个人工作区")}
            </span>
          </div>
        </header>
        <main id="workbench-main" className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                THE AUTHOR’S PRINT DESK <span>／</span> 0{stage + 1}
              </span>
              <h1>{stages[stage].heading}</h1>
              <p>{stages[stage].description}</p>
            </div>
            <span className="chapter-marker" aria-hidden="true">
              0{stage + 1}
              <span>/ 04</span>
            </span>
          </div>
          {store.error && (
            <div role="alert" className="notice error global-error">
              <CircleAlert size={20} />
              <div>
                <strong>{store.conflict ? "先保护好本地修改" : "这一步没有完成"}</strong>
                <p>{store.error}</p>
                <div className="button-row">
                  {book && (store.conflict || store.saveState === "error") && (
                    <button className="button" onClick={() => downloadDraft(book)}>
                      <Download size={15} />
                      下载本地草稿 JSON
                    </button>
                  )}
                  {store.conflict && (
                    <button
                      className="button"
                      disabled={!!store.busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "请先下载本地草稿。载入服务器版本会丢弃当前未保存编辑，不会把本地修改强制覆盖到服务器。是否继续？",
                          )
                        )
                          void store.reload();
                      }}
                    >
                      明确载入服务器版本
                    </button>
                  )}
                  {store.saveState === "error" && !store.conflict && (
                    <button
                      className="button"
                      disabled={store.locked}
                      onClick={() => void store.retrySave()}
                    >
                      重试保存
                    </button>
                  )}
                  {!book && (
                    <button className="button" onClick={() => window.location.reload()}>
                      重新读取书架
                    </button>
                  )}
                </div>
              </div>
              {!store.conflict && store.saveState !== "error" && (
                <button
                  className="icon-button"
                  aria-label="关闭错误提示"
                  onClick={store.dismissError}
                >
                  <X size={18} />
                </button>
              )}
            </div>
          )}
          {activeJobs && (
            <p className="notice task-notice" role="status">
              <LoaderCircle className="spinner" size={17} />
              生图任务正在运行；暂时锁定书本编辑，避免旧内容覆盖新候选。可在生成页查看进度与暂停。
            </p>
          )}
          {!store.loading && !book && (
            <section className="panel initial-spec-controls" aria-label="新绘本印刷选项">
              <fieldset className="spec-options" disabled={store.locked}>
                <NewBookSpecFields
                  ink={ink}
                  paper={paper}
                  bleed={bleed}
                  onInk={setInk}
                  onPaper={setPaper}
                  onBleed={setBleed}
                />
              </fieldset>
              <p className="field-hint">
                创建后仍可调整，并需核对官方规格。标准彩色至少 72 页，不适用于 32 页示例。
              </p>
            </section>
          )}
          {store.loading ? (
            <div className="loading-state" role="status">
              <LoaderCircle className="spinner" size={25} />
              <p>正在整理你的工作台…</p>
            </div>
          ) : !book ? (
            <section className="welcome panel">
              <div className="welcome-copy">
                <span className="eyebrow">第一本，从这里开始</span>
                <h2>
                  为你的故事，
                  <br />
                  准备一张干净的纸。
                </h2>
                <p>
                  不必先懂所有印刷术语。选一个尺寸，取一个名字，我们再一起把内容、画面和封面准备好。
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void create();
                  }}
                >
                  <fieldset disabled={store.locked}>
                    <Field label="这本绘本叫什么？">
                      <input
                        required
                        maxLength={200}
                        value={name}
                        placeholder="例如：小小森林的 A–Z"
                        onChange={(event) => setName(event.target.value)}
                      />
                    </Field>
                    <TrimPresets value={trim} change={setTrim} />
                    <p className="field-hint">
                      将使用上方选择的印刷方式、出血设置与此处的尺寸创建绘本；创建后仍可调整，并须核对官方规格。
                    </p>
                    <button
                      className="button primary"
                      disabled={store.locked || !name.trim()}
                      type="submit"
                    >
                      {store.busy ? "正在创建…" : "开始这本绘本"}
                      <ArrowRight size={17} />
                    </button>
                  </fieldset>
                </form>
                <div className="source-line">
                  <span>规格核对 {RULES.checkedAt}</span>
                  <a href={RULES.manuscriptUrl} target="_blank" rel="noreferrer">
                    KDP 官方内页规范
                  </a>
                </div>
              </div>
              <div className="welcome-art" aria-hidden="true">
                <div className="paper-under" />
                <div className="sample-cover">
                  <span>
                    THE LITTLE
                    <br />
                    BOOK OF
                  </span>
                  <strong>Wonders</strong>
                  <div className="botanical">
                    <Leaf size={110} strokeWidth={0.7} />
                  </div>
                  <i>每一页，都从一个想法开始。</i>
                  <small>A STORY BY YOU</small>
                </div>
                <span className="art-caption">一页一页，做成自己的书。</span>
              </div>
            </section>
          ) : (
            <div key={book.id}>
              {stage === 0 && (
                <ContentStage store={store} selectedId={selectedPage} select={setSelectedId} />
              )}
              {stage === 1 && (
                <GenerationStage store={store} selectedId={selectedPage} select={setSelectedId} />
              )}
              {stage === 2 && (
                <LayoutStage store={store} selectedId={selectedPage} select={setSelectedId} />
              )}
              {stage === 3 && (
                <ExportStage
                  store={store}
                  goToIssue={(issue) => {
                    if (issue.code.startsWith("cover-")) {
                      navigate(2);
                      return;
                    }
                    if (issue.pageId) setSelectedId(issue.pageId);
                    navigate(0);
                  }}
                />
              )}
            </div>
          )}
          {book && (
            <footer className="stage-footer">
              <div>
                <span className="eyebrow">STEP 0{stage + 1} OF 04</span>
                <span>
                  {book.pages.length} 页 · {book.config.trim.replace("x", " × ")} in ·{" "}
                  {inkLabel(book.config.ink)} · {paperLabel(book.config.paper)}
                </span>
              </div>
              <div className="button-row">
                {stage > 0 && (
                  <button className="button quiet" onClick={() => navigate(stage - 1)}>
                    <ArrowLeft size={16} />
                    上一步
                  </button>
                )}
                {stage < 3 && (
                  <button className="button primary" onClick={() => navigate(stage + 1)}>
                    下一步：{stages[stage + 1].title}
                    <ArrowRight size={17} />
                  </button>
                )}
              </div>
            </footer>
          )}
        </main>
        <footer className="workspace-footer">
          <span>纸间 · PERSONAL PICTURE BOOK STUDIO</span>
          <span>用心创作，认真印刷。</span>
        </footer>
      </div>
      {settingsOpen && <SettingsDialog book={book} close={() => setSettingsOpen(false)} />}
      {newOpen && (
        <Modal title="新的一本，新的开始" close={() => setNewOpen(false)} busy={!!store.busy}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Field label="绘本名称">
              <input
                required
                autoFocus
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <fieldset disabled={store.locked}>
              <TrimPresets value={trim} change={setTrim} />
              <div className="spec-options">
                <NewBookSpecFields
                  ink={ink}
                  paper={paper}
                  bleed={bleed}
                  onInk={setInk}
                  onPaper={setPaper}
                  onBleed={setBleed}
                />
              </div>
            </fieldset>
            <p className="field-hint">
              当前修改会先保存。新绘本将使用此处选择的印刷规格，不会覆盖现有作品。
            </p>
            <div className="modal-actions">
              <button className="button primary" disabled={store.locked || !name.trim()}>
                {store.busy ? "正在创建…" : "创建绘本"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
