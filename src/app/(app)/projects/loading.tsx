import ProjectSkeleton from "./_components/ProjectSkeleton";

/**
 * Route loading state for /projects: card-shaped skeletons in the
 * standard theme colors (Projects redesign Phase 2), replacing the
 * generic spinner so the loading moment matches the page it
 * resolves into.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8">
      <ProjectSkeleton />
    </div>
  );
}
