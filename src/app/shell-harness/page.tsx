import { notFound } from "next/navigation";
import HarnessClient from "./HarnessClient";

/**
 * Studio shell visual harness — composes the REAL shell components
 * (WorkspaceRail, WorktabBar, SelectionOverlay, ContextInspector +
 * ElementInspectorPanel, CommandComposer + ComposerContextStrip) against
 * fixture data and a same-origin fixture page, with NO auth and NO backend.
 *
 * Local/dev only. In production this route 404s.
 */
export default function StudioShellHarnessPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <HarnessClient />;
}
