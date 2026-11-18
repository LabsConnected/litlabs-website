/**
 * ProjectStatusBadge — thin presentation wrapper over
 * describeProjectState (src/lib/projects/project-state.ts).
 *
 * The state logic, labels, and palette live in project-state.ts and
 * are NOT forked here: this component only renders what that module
 * decides — including the honest "Repo workspace unavailable" state
 * (Decision B), whose label/detail/canRetry come straight from the
 * shipped honesty rules.
 */

import type { ProjectStateDescription } from "@/lib/projects/project-state";

interface ProjectStatusBadgeProps {
  state: ProjectStateDescription;
  /** The project is the last-opened one — show the Resume chip. */
  resumable?: boolean;
  accentColor: string;
}

export default function ProjectStatusBadge({
  state,
  resumable = false,
  accentColor,
}: ProjectStatusBadgeProps) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {resumable && (
        <span
          className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase"
          style={{
            backgroundColor: `${accentColor}18`,
            color: accentColor,
            border: `1px solid ${accentColor}45`,
          }}
        >
          Resume
        </span>
      )}
      <span
        className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase"
        style={{
          backgroundColor: `${state.color}18`,
          color: state.color,
          border: `1px solid ${state.color}35`,
        }}
      >
        {state.label}
      </span>
    </span>
  );
}
