type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type GenerationInput = { projectId: string; targetIds: string[]; count: number; sample: boolean };
type GenerationIntent = { operationId: string; signature: string; payload: GenerationInput };
const keyPrefix = "kdp-helper:generation-intent:v1:";
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function readIntent(
  storage: IntentStorage,
  signature: string,
): { operationId: string; signature: string } | null {
  let value: string | null;
  try {
    value = storage.getItem(keyPrefix + signature);
  } catch {
    throw new Error(
      "无法读取本地存储中的生图请求编号。为避免重复计费，本次不会提交，请先恢复本地存储权限。",
    );
  }
  if (value === null) return null;
  try {
    const record = JSON.parse(value);
    if (
      !record ||
      record.signature !== signature ||
      typeof record.operationId !== "string" ||
      !uuidPattern.test(record.operationId)
    )
      throw new Error("Invalid intent");
    return { operationId: record.operationId, signature };
  } catch {
    throw new Error(
      "本地生图提交记录损坏，未重新创建请求编号。请先核对任务和服务记录，避免重复计费。",
    );
  }
}

export function prepareGenerationIntent(
  storage: IntentStorage,
  input: GenerationInput,
): GenerationIntent {
  const payload = {
    projectId: input.projectId,
    targetIds: [...input.targetIds],
    count: input.count,
    sample: input.sample,
  };
  const signature = JSON.stringify(payload);
  const existing = readIntent(storage, signature);
  if (existing) return { ...existing, payload };
  const operationId = crypto.randomUUID();
  try {
    storage.setItem(keyPrefix + signature, JSON.stringify({ operationId, signature }));
  } catch {
    throw new Error(
      "无法写入本地存储以保留生图请求编号，本次尚未提交。请检查存储权限或空间后手动重试。",
    );
  }
  return { operationId, signature, payload };
}

export function clearGenerationIntent(storage: IntentStorage, intent: GenerationIntent): void {
  if (readIntent(storage, intent.signature)?.operationId !== intent.operationId) return;
  try {
    storage.removeItem(keyPrefix + intent.signature);
  } catch {
    throw new Error(
      "生图任务已返回，但本地提交记录未能清除。任务已显示；请勿把再次提交同一范围当作新任务。",
    );
  }
}
