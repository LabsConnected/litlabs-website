export default function AuthLoading() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#0a0a0f] p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="h-9 w-40 bg-white/10 rounded mx-auto mb-2 animate-pulse" />
          <div className="h-3 w-56 bg-white/10 rounded mx-auto animate-pulse" />
        </div>
        <div className="h-64 bg-white/5 rounded-xl border border-white/10 animate-pulse" />
      </div>
    </div>
  );
}
