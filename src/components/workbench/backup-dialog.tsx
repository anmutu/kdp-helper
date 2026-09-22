import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { BACKUP_LIMITS } from "@/domain/project-files";
import { Field, Modal } from "./controls";
import type { Workbench } from "./use-workbench";

export function BackupDialog({
  store,
  close,
  restored,
}: {
  store: Workbench;
  close: () => void;
  restored: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const limitMiB = BACKUP_LIMITS.archiveBytes / 1024 / 1024;
  return (
    <Modal title="备份与恢复" close={close} busy={!!store.busy}>
      <div className="form-stack">
        <p>
          备份可编辑内容、全部候选与参考图，以及已完成的历史导出。不包含 API
          Key、连接设置或生成任务。
        </p>
        <button
          className="button"
          disabled={store.locked || !store.book}
          onClick={async () => {
            setNotice("");
            if (await store.downloadBackup())
              setNotice(
                "备份已生成并交给浏览器下载。请确认下载完成，再保存到另一块磁盘或你的备份位置。",
              );
          }}
        >
          <Download size={17} />
          {store.busy === "正在制作项目备份…" ? "正在打包…" : "下载当前绘本备份"}
        </button>
        {!store.book && <p className="field-hint">先打开一本书才能备份；也可以直接从下方恢复。</p>}
        <div className="export-divider" />
        <Field
          label="选择 .kdp.zip 备份"
          hint={`上限 ${limitMiB} MiB，仅接受本工具生成且未重新压缩的备份。`}
        >
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={store.locked}
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setNotice("");
            }}
          />
        </Field>
        <p className="notice">
          恢复会新建“恢复副本”，不会覆盖现有绘本。规格和选图需要重新确认；历史 PDF
          仍属于原来的快照，不会自动重发任何生图请求。
        </p>
        <button
          className="button primary"
          disabled={store.locked || !file}
          onClick={async () => {
            if (
              !file ||
              !window.confirm(
                "将从备份新建一本恢复副本，不覆盖现有绘本，也不恢复 API Key 或生成任务。是否继续？",
              )
            )
              return;
            setNotice("");
            const book = await store.restoreBackup(file);
            if (book) {
              setNotice(`已创建《${book.name}》，请重新检查规格与选图。`);
              setFile(null);
              restored();
            }
          }}
        >
          <Upload size={17} />
          {store.busy === "正在验证并恢复备份…" ? "正在验证并恢复…" : "恢复为新绘本"}
        </button>
        {store.error && (
          <p className="notice error" role="alert">
            {store.error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <p className="field-hint">
          只导入可信来源的备份。ZIP 不加密，可能包含尚未发表的作品。超过容量限制时，请手工复制
          projects、assets 和 exports 目录，勿分享 settings.json。
        </p>
      </div>
    </Modal>
  );
}
