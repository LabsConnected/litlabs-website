import type { NextRequest } from "next/server";

export class PairingBodyTooLarge extends Error {}

/** Count bytes from the stream itself; Content-Length is not trusted. */
export async function readPairingJson(request: NextRequest, limit = 10_000): Promise<unknown> {
  if (!request.body) throw new SyntaxError("Missing JSON body");
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel().catch(() => undefined);
        throw new PairingBodyTooLarge("Pairing request body exceeds 10 KB");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, received).toString("utf8"));
}
