/**
 * Placeholder for the LiTT App. Conversation UI arrives in a later phase.
 * The layout hides this route unless `NEXT_PUBLIC_LITT_APP_ENABLED` is on.
 */
export default function LittAppPage() {
  return (
    <main id="main-content" className="flex flex-1 flex-col px-5 py-8">
      <h1 className="text-xl font-semibold tracking-tight">LiTT</h1>
      <p className="mt-2 max-w-sm text-sm text-[#9ba7c7]">
        Your conversation will show up here.
      </p>
    </main>
  );
}
