import { NextResponse } from "next/server";

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  return error instanceof Error ? error.message : fallback;
}

/** Standard JSON error response. */
export function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

/** 401 Unauthorized JSON response. */
export function unauthorized(message = "Unauthorized") {
  return jsonError(message, 401);
}
