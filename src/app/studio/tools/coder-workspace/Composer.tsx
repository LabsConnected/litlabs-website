/**
 * Composer — persistent message input at the bottom of the left rail.
 *
 * Phase 1: visible but non-functional. The Send button is disabled with a
 * tooltip explaining that it connects to /api/litt/run in Phase 2.
 */

interface ThemeColors {
  borderColor: string;
}

export function Composer({ T }: { T: ThemeColors }) {
  return (
    <div
      className="shrink-0 border-t px-3 py-2"
      style={{ borderColor: `${T.borderColor}30` }}
    >
      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          placeholder="Describe what to build… (connects to /api/litt/run in Phase 2)"
          className="min-h-[36px] max-h-[120px] flex-1 resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-white/20"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              // Phase 1: no-op. Phase 2 wires this to /api/litt/run.
            }
          }}
        />
        <button
          type="button"
          disabled
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-bold text-white/30"
          title="Enabled in Phase 2 when /api/litt/run is available"
        >
          Send
        </button>
      </div>
    </div>
  );
}
