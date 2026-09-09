/** 语义编译错误：带 JSON Pointer 路径（编辑器据此标红）。 */
export class DocumentError extends Error {
  readonly pointer: string;
  readonly code: string;
  constructor(code: string, pointer: string, message: string) {
    super(message);
    this.code = code;
    this.pointer = pointer;
  }
}

export class DocumentErrors extends Error {
  readonly errors: DocumentError[];
  constructor(errors: DocumentError[]) {
    super(`DWP document invalid (${errors.length}): ` +
      errors.slice(0, 5).map(e => `${e.code}@${e.pointer}: ${e.message}`).join(' | '));
    this.errors = errors;
  }
}
