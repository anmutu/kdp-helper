import { useEffect, useState } from "react";
import { Download, History } from "lucide-react";
import type { ExportHistory } from "@/domain/project-files";
import { request } from "./ui-helpers";

export function ExportHistoryList({
  projectId,
  revision,
  refreshToken,
  saved,
}: {
  projectId: string;
  revision: number;
  refreshToken: string;
  saved: boolean;
}) {
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    history?: ExportHistory;
    error?: string;
  } | null>(null);
  const key = `${projectId}:${revision}:${refreshToken}:${retry}`;
  useEffect(() => {
    let cancelled = false;
    void request<ExportHistory>(`/api/exports/${projectId}`).then(
      (history) => {
        if (!cancelled) setLoaded({ key, history });
      },
      (cause) => {
        if (!cancelled)
          setLoaded({ key, error: cause instanceof Error ? cause.message : "历史记录读取失败。" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, key]);
  const result = loaded?.key === key ? loaded : null;
  return (
    <section className="panel form-stack" aria-label="导出历史">
      <div className="section-heading">
        <div>
          <span className="eyebrow">保留每一次定稿</span>
          <h2>导出历史</h2>
        </div>
        <History size={24} />
      </div>
      <p className="field-hint">
        这里读取本机已完成的版本，切换步骤或重启后仍可下载。旧快照不代表当前内容已经通过检查。
      </p>
      {!result && <p role="status">正在读取历史版本…</p>}
      {result?.error && (
        <p role="alert" className="notice error">
          {result.error}
        </p>
      )}
      {result && (
        <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
          刷新历史
        </button>
      )}
      {result?.history?.items.length === 0 && <p>这本书还没有可下载的完整导出记录。</p>}
      {result?.history?.problems.map((problem) => (
        <p className="notice" key={problem.version}>
          <code>{problem.version}</code>：{problem.message}
        </p>
      ))}
      {result?.history?.items.map((entry) => (
        <details key={entry.version}>
          <summary>
            {entry.draft ? "草稿 · 禁止上传" : "正式文件 · 尚需 KDP 审核"}
            {" · "}
            {entry.target === "all" ? "完整绘本" : "仅内页"}
            {" · "}
            {new Date(entry.createdAt).toLocaleString()}
          </summary>
          <p className="field-hint">
            {entry.pageCount} 页 · 内容版本 {entry.sourceVersion} ·{" "}
            {entry.current && saved ? "对应当前已保存快照" : "历史快照，非当前已确认内容"}
          </p>
          <p className="field-hint">
            <code>{entry.version}</code>
          </p>
          <div className="file-links">
            {entry.files.map((file) => (
              <a className="button" key={file.url} href={file.url} target="_blank" rel="noreferrer">
                <Download size={16} />
                {file.name}
              </a>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}
