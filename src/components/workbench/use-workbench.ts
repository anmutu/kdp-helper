"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Book, BookPage, ExportResult, Job } from "@/domain/book";
import {
  editBook,
  jobIsInFlight,
  mergeSavedBook,
  request,
  RequestError,
  type BookEdit,
  type ExportTarget,
} from "./ui-helpers";
import { clearGenerationIntent, prepareGenerationIntent } from "./generation-intent";

export function useWorkbench() {
  const [book, setBook] = useState<Book | null>(null);
  const [projects, setProjects] = useState<Book[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [conflict, setConflict] = useState(false);
  const current = useRef<Book | null>(null);
  const revision = useRef(0);
  const persisted = useRef(0);
  const flight = useRef<Promise<Book | null> | null>(null);
  const exclusive = useRef(false);
  const blocked = useRef(false);
  const taskActive = useRef(false);
  const pollInFlight = useRef<Promise<void> | null>(null);
  const pausedAutosave = useRef(false);

  const publish = useCallback((value: Book) => {
    current.current = value;
    setBook(value);
    setProjects((previous) => [value, ...previous.filter((item) => item.id !== value.id)]);
  }, []);

  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "操作未完成，请重试。");
    if (cause instanceof RequestError && cause.status === 409) {
      blocked.current = true;
      setConflict(true);
      setError(
        "服务器已有较新版本。本地修改仍保留，自动保存已停止；请先下载本地草稿，再明确载入服务器版本。不会静默覆盖任一版本。",
      );
    }
  }, []);

  const install = useCallback(
    (value: Book, nextJobs?: Job[]) => {
      revision.current = 0;
      persisted.current = 0;
      pausedAutosave.current = false;
      publish(value);
      setSaveState("saved");
      if (nextJobs) {
        setJobs(nextJobs);
        taskActive.current = nextJobs.some(jobIsInFlight);
      }
    },
    [publish],
  );

  const flush = useCallback(async (): Promise<Book | null> => {
    if (blocked.current) throw new Error("请先处理版本冲突，本地修改尚未保存。");
    if (flight.current) return flight.current;
    const operation = async () => {
      while (current.current && persisted.current < revision.current) {
        const snapshot = current.current;
        const savingRevision = revision.current;
        setSaveState("saving");
        try {
          const result = await request<{ book: Book }>(`/api/projects/${snapshot.id}`, {
            method: "PUT",
            body: JSON.stringify({ book: snapshot }),
          });
          if (current.current?.id !== snapshot.id) return current.current;
          publish(mergeSavedBook(snapshot, current.current, result.book));
          persisted.current = savingRevision;
        } catch (cause) {
          pausedAutosave.current = true;
          setSaveState("error");
          report(cause);
          throw cause;
        }
      }
      pausedAutosave.current = false;
      setSaveState("saved");
      return current.current;
    };
    flight.current = operation();
    try {
      return await flight.current;
    } finally {
      flight.current = null;
    }
  }, [publish, report]);

  const edit = useCallback(
    (change: BookEdit) => {
      if (!current.current || exclusive.current || taskActive.current || blocked.current) return;
      revision.current += 1;
      publish(editBook(current.current, change));
      setSaveState(pausedAutosave.current ? "error" : "pending");
    },
    [publish],
  );

  useEffect(() => {
    if (saveState !== "pending" || blocked.current || pausedAutosave.current || taskActive.current)
      return;
    const timer = setTimeout(() => {
      void flush().catch(() => undefined);
    }, 1000);
    return () => clearTimeout(timer);
  }, [book, saveState, flush]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        persisted.current < revision.current ||
        flight.current ||
        exclusive.current ||
        blocked.current
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await request<{ projects: Book[] }>("/api/projects");
        if (cancelled) return;
        setProjects(result.projects);
        if (result.projects[0]) {
          const id = result.projects[0].id;
          const [project, tasks] = await Promise.all([
            request<{ book: Book }>(`/api/projects/${id}`),
            request<{ jobs: Job[] }>(`/api/jobs?projectId=${id}`),
          ]);
          if (!cancelled) install(project.book, tasks.jobs);
        }
      } catch (cause) {
        if (!cancelled) report(cause);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [install, report]);

  useEffect(() => {
    if (!book?.id) return;
    let cancelled = false;
    const id = book.id;
    const poll = async () => {
      if (exclusive.current || flight.current || pollInFlight.current || blocked.current) return;
      const operation = async () => {
        try {
          const result = await request<{ jobs: Job[] }>(`/api/jobs?projectId=${id}`);
          if (cancelled || current.current?.id !== id) return;
          const wasActive = taskActive.current;
          const isActive = result.jobs.some(jobIsInFlight);
          if (isActive) taskActive.current = true;
          if (wasActive || isActive) {
            if (persisted.current < revision.current) {
              setJobs(result.jobs);
              report(new RequestError("检测到任务期间存在本地修改。", 409));
              return;
            }
            const resultBook = await request<{ book: Book }>(`/api/projects/${id}`);
            if (!cancelled && current.current?.id === id && persisted.current === revision.current)
              publish(resultBook.book);
          }
          if (!cancelled && current.current?.id === id) {
            taskActive.current = isActive;
            setJobs(result.jobs);
          }
        } catch (cause) {
          if (!cancelled) report(cause);
        }
      };
      pollInFlight.current = operation();
      try {
        await pollInFlight.current;
      } finally {
        pollInFlight.current = null;
      }
    };
    const interval = setInterval(() => {
      void poll();
    }, 1800);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [book?.id, publish, report]);

  const run = useCallback(
    async <T>(
      label: string,
      action: (saved: Book | null) => Promise<T>,
      options?: { allowTask?: boolean; discard?: boolean },
    ): Promise<T | undefined> => {
      if (
        exclusive.current ||
        (taskActive.current && !options?.allowTask) ||
        (blocked.current && !options?.discard)
      )
        return;
      exclusive.current = true;
      setBusy(label);
      setError("");
      try {
        if (pollInFlight.current) await pollInFlight.current;
        if (taskActive.current && !options?.allowTask)
          throw new Error("检测到正在执行的图片请求，请等待完成后再编辑。");
        const saved = options?.discard ? current.current : await flush();
        return await action(saved);
      } catch (cause) {
        report(cause);
        return undefined;
      } finally {
        exclusive.current = false;
        setBusy("");
      }
    },
    [flush, report],
  );

  const create = (name: string) =>
    run("正在创建绘本…", async () => {
      const result = await request<{ book: Book }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      install(result.book, []);
      return result.book;
    });

  const open = (id: string) =>
    run("正在打开绘本…", async () => {
      const [result, tasks] = await Promise.all([
        request<{ book: Book }>(`/api/projects/${id}`),
        request<{ jobs: Job[] }>(`/api/jobs?projectId=${id}`),
      ]);
      install(result.book, tasks.jobs);
    });

  const reload = () =>
    run(
      "正在载入服务器版本…",
      async (saved) => {
        if (!saved) return;
        const [result, tasks] = await Promise.all([
          request<{ book: Book }>(`/api/projects/${saved.id}`),
          request<{ jobs: Job[] }>(`/api/jobs?projectId=${saved.id}`),
        ]);
        install(result.book, tasks.jobs);
        blocked.current = false;
        setConflict(false);
      },
      { discard: true, allowTask: true },
    );

  const upload = (file: File, targetId: string) =>
    run("正在导入图片…", async (saved) => {
      if (!saved) return;
      if (!["image/png", "image/jpeg"].includes(file.type))
        throw new Error("请导入 PNG 或 JPEG 图片。");
      if (file.size > 32 * 1024 * 1024) throw new Error("请选择不大于 32 MB 的 PNG 或 JPEG 图片。");
      const data = new FormData();
      data.set("file", file);
      data.set("projectId", saved.id);
      data.set("targetId", targetId);
      const result = await request<{ book: Book }>("/api/assets", { method: "POST", body: data });
      install(result.book);
    });

  const remove = (id: string) =>
    run("正在删除绘本…", async () => {
      await request<{ deleted: boolean }>(`/api/projects/${id}`, { method: "DELETE" });
      const remaining = (await request<{ projects: Book[] }>("/api/projects")).projects;
      setProjects(remaining);
      if (current.current?.id === id) {
        current.current = null;
        revision.current = 0;
        persisted.current = 0;
        pausedAutosave.current = false;
        blocked.current = false;
        taskActive.current = false;
        setBook(null);
        setJobs([]);
        setConflict(false);
        setSaveState("saved");
        if (remaining[0]) {
          const [project, tasks] = await Promise.all([
            request<{ book: Book }>(`/api/projects/${remaining[0].id}`),
            request<{ jobs: Job[] }>(`/api/jobs?projectId=${remaining[0].id}`),
          ]);
          install(project.book, tasks.jobs);
        }
      }
    });

  const removeCandidate = (targetId: string, assetId: string) =>
    run("正在删除候选…", async (saved) => {
      if (!saved) return;
      const result = await request<{ book: Book }>(`/api/assets/${assetId}`, {
        method: "DELETE",
        body: JSON.stringify({ projectId: saved.id, targetId }),
      });
      install(result.book);
    });

  const reuseAsset = (targetId: string, assetId: string) =>
    run("正在复用插画…", async (saved) => {
      if (!saved) return;
      const result = await request<{ book: Book }>("/api/assets", {
        method: "POST",
        body: JSON.stringify({ projectId: saved.id, targetId, assetId }),
      });
      install(result.book);
    });

  const generate = (targetIds: string[], count: number, sample: boolean) =>
    run("正在提交生图任务…", async (saved) => {
      if (!saved?.specConfirmed) throw new Error("请先保存并重新确认出版规格。");
      let storage: Storage;
      try {
        storage = window.localStorage;
      } catch {
        throw new Error("本地存储不可用，无法持久保留请求编号。为避免重复计费，本次尚未提交。");
      }
      const intent = prepareGenerationIntent(storage, {
        projectId: saved.id,
        targetIds,
        count,
        sample,
      });
      const result = await request<{ job: Job }>("/api/generate", {
        method: "POST",
        body: JSON.stringify({ ...intent.payload, operationId: intent.operationId }),
      });
      if (!result.job?.id || !Array.isArray(result.job.items))
        throw new Error(
          "服务未返回有效任务。请求编号已保留，手动重试相同请求会复用该编号，不会自动重试。",
        );
      taskActive.current = jobIsInFlight(result.job);
      setJobs((previous) => [result.job, ...previous.filter((job) => job.id !== result.job.id)]);
      clearGenerationIntent(storage, intent);
      if (!taskActive.current) {
        try {
          const latest = await request<{ book: Book }>(`/api/projects/${saved.id}`);
          install(latest.book);
        } catch (cause) {
          throw new Error(
            `生图任务已确认并显示在任务记录中，但刷新候选失败。请重新打开绘本查看，不要为此重复提交生图。${cause instanceof Error ? cause.message : ""}`,
          );
        }
      }
    });

  const pause = (id: string) =>
    run(
      "正在请求暂停…",
      async () => {
        const result = await request<{ job: Job }>("/api/jobs", {
          method: "POST",
          body: JSON.stringify({ id, action: "pause" }),
        });
        setJobs((previous) => previous.map((job) => (job.id === id ? result.job : job)));
        const saved = current.current;
        if (saved) {
          const [project, tasks] = await Promise.all([
            request<{ book: Book }>(`/api/projects/${saved.id}`),
            request<{ jobs: Job[] }>(`/api/jobs?projectId=${saved.id}`),
          ]);
          install(project.book, tasks.jobs);
        }
      },
      { allowTask: true },
    );

  const outline = (targetPages: number) =>
    run("正在整理文字草稿…", async (saved) => {
      if (!saved?.specConfirmed) throw new Error("请先保存并确认出版规格。");
      return (
        await request<{ pages: BookPage[] }>("/api/outline", {
          method: "POST",
          body: JSON.stringify({ projectId: saved.id, targetPages }),
        })
      ).pages;
    });

  const exportBook = (draft: boolean, reviewed: boolean, target: ExportTarget = "all") =>
    run("正在制作 PDF…", async (saved) => {
      if (!saved) return;
      return (
        await request<{ export: ExportResult }>("/api/export", {
          method: "POST",
          body: JSON.stringify({ projectId: saved.id, draft, reviewed, target }),
        })
      ).export;
    });

  const hasActiveJob = jobs.some(jobIsInFlight);
  return {
    book,
    projects,
    jobs,
    loading,
    busy,
    error,
    saveState,
    conflict,
    locked: loading || !!busy || hasActiveJob || conflict,
    edit,
    create,
    open,
    reload,
    upload,
    remove,
    removeCandidate,
    reuseAsset,
    generate,
    pause,
    outline,
    exportBook,
    retrySave: () => run("正在保存…", async () => undefined),
    dismissError: () => setError(""),
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
