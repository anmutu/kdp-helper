import type { Issue } from "@/domain/book";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ExportValidationError extends AppError {
  constructor(public issues: Issue[]) {
    super(
      `正式导出被阻止：\n${issues
        .filter((issue) => issue.severity === "error")
        .slice(0, 8)
        .map((issue) => issue.message)
        .join("\n")}`,
      422,
    );
    this.name = "ExportValidationError";
  }
}
