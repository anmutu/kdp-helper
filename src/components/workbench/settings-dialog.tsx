import { useEffect, useState } from "react";
import { Check, KeyRound } from "lucide-react";
import type { Book, PublicSettings } from "@/domain/book";
import { generationAdequacy } from "@/domain/print-spec";
import { Field, Modal } from "./controls";
import { request } from "./ui-helpers";

export function SettingsDialog({ book, close }: { book: Book | null; close: () => void }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    request<{ settings: PublicSettings }>("/api/settings")
      .then((result) => {
        if (!cancelled) setSettings(result.settings);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const update = (patch: Partial<PublicSettings>) => {
    setSettings((previous) => previous && { ...previous, ...patch });
    setSaved(false);
  };
  async function save() {
    if (!settings) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const { baseUrl, imageModel, textModel, imageSize, referenceSupported } = settings;
      const result = await request<{ settings: PublicSettings }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          baseUrl,
          imageModel,
          textModel,
          imageSize,
          referenceSupported,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      setSettings(result.settings);
      setApiKey("");
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "设置保存失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="连接与模型设置" close={close} busy={busy}>
      <p className="muted">密钥仅交给本地服务保存，不回显。保存设置不会发起付费调用。</p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!settings ? (
        <p role="status">{error ? "无法读取设置。请关闭后重试。" : "正在读取设置…"}</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="form-stack">
            <Field label="API 地址" hint="默认 https://api.coderplan.ai/v1；请仅连接你信任的服务。">
              <input
                required
                type="url"
                value={settings.baseUrl}
                placeholder="https://api.coderplan.ai/v1"
                onChange={(event) => update({ baseUrl: event.target.value })}
              />
            </Field>
            <Field
              label="API Key"
              hint={
                settings.hasKey
                  ? "已保存密钥；留空会保留原密钥。"
                  : "尚未配置密钥；不影响手工编辑和图片导入。"
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={apiKey}
                placeholder={settings.hasKey ? "已配置 · 留空不更换" : "输入 API Key"}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setSaved(false);
                }}
              />
            </Field>
            <div className="key-status">
              <KeyRound size={15} />
              {settings.hasKey ? "本地密钥已配置" : "本地密钥未配置"}
            </div>
            <div className="field-pair">
              <Field label="图片模型">
                <input
                  required
                  value={settings.imageModel}
                  onChange={(event) => update({ imageModel: event.target.value })}
                />
              </Field>
              <Field label="文字模型（可选）">
                <input
                  value={settings.textModel}
                  onChange={(event) => update({ textModel: event.target.value })}
                />
              </Field>
            </div>
            <Field
              label="请求图片尺寸"
              hint="如 1024x1024。尺寸须由模型支持；下方按当前绘本的版式估算有效 DPI，服务端会在正式生图前再次检查。"
            >
              <input
                required
                value={settings.imageSize}
                onChange={(event) => update({ imageSize: event.target.value })}
              />
            </Field>
            {(() => {
              const match = settings.imageSize.match(/^(\d{3,5})x(\d{3,5})$/);
              const width = match ? Number(match[1]) : 0;
              const height = match ? Number(match[2]) : 0;
              if (!book || !width || !height) return null;
              return (
                <div className="page-metrics">
                  {generationAdequacy(book.config, book.pages.length, { width, height }).map(
                    (row) => (
                      <span key={row.label} className={row.ok ? "success" : "warning-text"}>
                        {row.label}：约 {row.dpi} DPI
                        {row.ok ? " · 可印刷" : " · 不足 300，只能低清试画"}
                      </span>
                    ),
                  )}
                </div>
              );
            })()}
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.referenceSupported}
                onChange={(event) => update({ referenceSupported: event.target.checked })}
              />
              <span>我已确认此图片接口支持参考图输入</span>
            </label>
            <div className="modal-actions">
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? "正在保存…" : "保存设置"}
              </button>
              {saved && (
                <span className="success" role="status">
                  <Check size={16} />
                  设置已保存
                </span>
              )}
            </div>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
