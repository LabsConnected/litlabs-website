import { LITT_UPLOAD_PATH, LITT_UPLOAD_PURPOSE } from "./endpoints";

/**
 * Attachment upload request used by Studio's `useStudioAttachments`.
 *
 * The hook still builds this inline (it also owns preview URLs, abort,
 * and retry state). Phase 0 leaves that hook alone. The LiTT App should
 * call `uploadAttachment` so the multipart shape stays one definition:
 * POST `/api/upload`, fields `file` and `purpose=studio-attachment`,
 * and no `Content-Type` header — the browser has to set the multipart
 * boundary. Studio does not attach a Clerk bearer on this call; cookies
 * authenticate it. This helper matches that.
 */

export interface AttachmentUploadRequest {
  url: string;
  method: "POST";
  body: FormData;
}

export function buildAttachmentUploadRequest(file: Blob, filename?: string): AttachmentUploadRequest {
  const body = new FormData();
  body.append("file", file, filename);
  body.append("purpose", LITT_UPLOAD_PURPOSE);
  return { url: LITT_UPLOAD_PATH, method: "POST", body };
}

export async function uploadAttachment(
  file: File,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = buildAttachmentUploadRequest(file, file.name);
  return fetchImpl(request.url, {
    method: request.method,
    body: request.body,
    signal: options.signal,
  });
}
