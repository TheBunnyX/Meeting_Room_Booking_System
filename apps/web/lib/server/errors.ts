import { NextResponse } from "next/server";

/** An expected failure that is reported to the client in the stable `{ error }` shape. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field: string | null = null,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  field: string | null = null,
  headers?: Record<string, string>,
) {
  return NextResponse.json({ error: { code, message, field } }, { status, headers });
}
