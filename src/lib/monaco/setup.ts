"use client";

/**
 * Bundled-Monaco setup: binds @monaco-editor/react's loader to the
 * monaco-editor package in the dependency graph instead of letting it fetch
 * vs/loader.js from cdn.jsdelivr.net. The CDN host is intentionally absent
 * from the app's CSP script-src(-elem) — bundling removes the external
 * script dependency without weakening the policy.
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

let configured = false;

export function configureBundledMonaco(): void {
  if (configured) return;
  if (typeof self !== "undefined") {
    try {
      (self as unknown as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
        getWorker(_workerId: string, label: string): Worker {
          if (label === "json") {
            return new Worker(new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url));
          }
          if (label === "css" || label === "scss" || label === "less") {
            return new Worker(new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url));
          }
          if (label === "html" || label === "handlebars" || label === "razor") {
            return new Worker(new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url));
          }
          if (label === "typescript" || label === "javascript") {
            return new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url));
          }
          return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url));
        },
      };
    } catch {
      // Worker bootstrap is best-effort — monaco degrades to synchronous
      // language services when workers cannot be constructed.
    }
  }
  loader.config({ monaco });
  configured = true;
}
