"use client";

import { useWorkspaceStore } from "./workspace-store";

export function WorkspaceInspector() {
  const document = useWorkspaceStore((state) => state.document);
  const selectedIds = useWorkspaceStore((state) => state.selectedIds);
  const commit = useWorkspaceStore((state) => state.commit);
  const object = document.objects.find((item) => item.id === selectedIds[0]);
  if (!object || selectedIds.length !== 1) {
    return <p className="text-[12px] text-white/45">Select a window to edit its title, frame, accent, and tags.</p>;
  }
  const links = document.relationships.filter((item) => item.fromId === object.id || item.toId === object.id);
  return (
    <div key={object.id} data-testid="workspace-inspector" className="space-y-3 text-[12px] text-white/80">
      <label className="block">
        Title
        <input
          aria-label="Window title"
          defaultValue={object.title}
          className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1"
          onBlur={(event) => {
            if (event.target.value !== object.title) {
              void commit({ type: "workspace.update", id: object.id, title: event.target.value }, { type: "workspace.update", id: object.id, patch: { title: object.title } });
            }
          }}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(["x", "y", "width", "height"] as const).map((key) => (
          <label key={key} className="block capitalize">
            {key}
            <input
              aria-label={`Frame ${key}`}
              type="number"
              defaultValue={object.frame[key]}
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1"
              onBlur={(event) => {
                const frame = { ...object.frame, [key]: Number(event.target.value) };
                void commit({ type: "workspace.update", id: object.id, frame }, { type: "workspace.update", id: object.id, patch: { frame: object.frame } });
              }}
            />
          </label>
        ))}
      </div>
      <label className="block">
        Accent
        <input
          aria-label="Window accent"
          defaultValue={object.accent ?? ""}
          className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1"
          onBlur={(event) => void commit({ type: "workspace.update", id: object.id, accent: event.target.value || null }, { type: "workspace.update", id: object.id, patch: { accent: object.accent } })}
        />
      </label>
      <label className="block">
        Tags
        <input
          aria-label="Window tags"
          value={object.tags.join(", ")}
          className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1"
          onBlur={(event) => void commit({ type: "workspace.update", id: object.id, tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) }, { type: "workspace.update", id: object.id, patch: { tags: object.tags } })}
        />
      </label>
      {object.type === "note" ? (
        <label className="block">
          Note
          <textarea
            aria-label="Inspector note"
            defaultValue={String(object.payload.body ?? "")}
            className="mt-1 h-24 w-full rounded border border-white/10 bg-black/40 px-2 py-1"
            onBlur={(event) => void commit({ type: "workspace.update", id: object.id, noteBody: event.target.value }, { type: "workspace.update", id: object.id, patch: { payload: { body: object.payload.body ?? "" } } })}
          />
        </label>
      ) : null}
      <div>
        <p className="text-white/45">Links</p>
        {links.length === 0 ? <p>No links</p> : links.map((link) => <p key={link.id}>{link.fromId} → {link.toId}</p>)}
      </div>
    </div>
  );
}
