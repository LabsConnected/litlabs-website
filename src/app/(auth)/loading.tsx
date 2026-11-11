export default function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f9f1] p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="h-9 w-40 bg-[#0e1510]/10 rounded mx-auto mb-2 animate-pulse" />
          <div className="h-3 w-56 bg-[#0e1510]/10 rounded mx-auto animate-pulse" />
        </div>
        <div className="h-64 bg-[#0e1510]/5 rounded-xl border border-[#0e1510]/10 animate-pulse" />
      </div>
    </div>
  );
}
