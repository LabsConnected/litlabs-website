export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error || null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] p-6 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-[-10%] left-[-5%] w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-white mb-1">
            lit<span className="text-blue-500">labs</span>
          </h1>
          <p className="text-sm text-zinc-500">Build AI Agents</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8">
          <h2 className="text-lg font-bold mb-6 text-center">Sign In</h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 text-sm font-medium mb-4">
              {decodeURIComponent(error.replace(/\+/g, " "))}
            </div>
          )}

          <form method="POST" action="/api/auth/login" className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-zinc-400 mb-1.5">
                Email
              </label>
              <input
                id="email"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-zinc-400 mb-1.5">
                Password
              </label>
              <input
                id="password"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </div>

            <button type="submit" className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors">
              Sign In
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-zinc-600 mt-6">
          LitLabs v3.0 · AI-Powered Platform
        </p>
      </div>
    </div>
  );
}
