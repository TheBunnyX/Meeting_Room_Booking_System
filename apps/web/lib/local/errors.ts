/** An expected failure, reported to the UI in the stable `{ error: { code, message, field } }` shape. */
export class LocalApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field: string | null = null,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "LocalApiError";
  }
}
