"use client";

import { useEffect, useState } from "react";
import { Check, Compass, X } from "lucide-react";
import type { Book } from "@/domain/book";
import { deriveOnboarding, request } from "./ui-helpers";

export const ONBOARDING_HIDE_KEY = "kdp-helper:onboarding-hidden";

// 新手领路人：做一本书的进度任务卡（Notion/Figma 式 checklist）。
// 任务状态从书本与服务状态自动推导，每项带「为什么」，点击直达对应步骤。
export function OnboardingCard({
  book,
  navigate,
  onClose,
}: {
  book: Book;
  navigate: (target: number | "settings") => void;
  onClose: () => void;
}) {
  const [flags, setFlags] = useState<{ hasKey: boolean; hasDraftExport: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [settings, history] = await Promise.all([
          request<{ settings: { hasKey: boolean } }>("/api/settings"),
          request<{ items: { draft: boolean }[] }>(`/api/exports/${book.id}`).catch(() => ({
            items: [] as { draft: boolean }[],
          })),
        ]);
        if (cancelled) return;
        setFlags({
          hasKey: settings.settings.hasKey,
          hasDraftExport: history.items.some((item) => item.draft),
        });
      } catch {
        if (!cancelled) setFlags({ hasKey: false, hasDraftExport: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [book.id, book.version]);

  const tasks = deriveOnboarding(book, flags ?? { hasKey: false, hasDraftExport: false });
  const required = tasks.filter((task) => !task.optional);
  const done = required.filter((task) => task.done).length;
  const allDone = done === required.length;
  return (
    <section className="onboarding-card" aria-label="新手引导">
      <div className="onboarding-head">
        <Compass size={17} />
        <strong>做一本书 · 新手引导</strong>
        <span className="onboarding-count">
          {done}/{required.length}
        </span>
        <span className="onboarding-progress" aria-hidden="true">
          <span style={{ width: `${(done / required.length) * 100}%` }} />
        </span>
        <button type="button" className="icon-button" aria-label="收起新手引导" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {allDone && (
        <p className="onboarding-done">
          🎉 必做项全部完成，这本书已经上路了。需要时从左侧「新手引导」随时回看这张卡。
        </p>
      )}
      <div className="onboarding-list">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            className={`onboarding-item ${task.done ? "done" : ""}`}
            onClick={() => navigate(task.target)}
          >
            <span className="ob-check" aria-hidden="true">
              {task.done ? <Check size={15} /> : <span className="ob-dot" />}
            </span>
            <span className="ob-body">
              <strong>
                {task.title}
                {task.optional && <em className="ob-tag">可选</em>}
              </strong>
              <small className="why">{task.why}</small>
            </span>
            <span className="ob-go">
              {task.target === "settings" ? "去设置" : `第 ${task.target + 1} 步`}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// 情境化「为什么是这一步」导语条（默认折叠，不挡熟练用户）。
export function StageWhy({ children }: { children: React.ReactNode }) {
  return (
    <details className="stage-why">
      <summary>新手看这里：为什么是这一步？</summary>
      <div className="stage-why-body">{children}</div>
    </details>
  );
}
