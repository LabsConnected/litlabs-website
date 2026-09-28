/**
 * Studio import path for attachment types and validation.
 * Implementation lives in `@/lib/litt-client/attachment-types`.
 */
export {
  MAX_ATTACHMENTS,
  SIZE_LIMITS,
  ACCEPTED_MIME,
  EXTENSION_MAP,
  ACCEPT_STRINGS,
  getExtension,
  classifyFile,
  validateFile,
  formatFileSize,
  isLinkUrl,
  linkCategory,
} from "@/lib/litt-client/attachment-types";
export type {
  Attachment,
  AttachmentCategory,
  AttachmentStatus,
} from "@/lib/litt-client/attachment-types";
