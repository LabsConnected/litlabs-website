export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error || null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-cyber-bg p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-heading text-3xl font-bold gradient-text mb-2">
            LITLABS
          </h1>
          <p className="text-text-muted text-sm font-code tracking-widest">
            AI-NATIVE WORKSPACE
          </p>
        </div>
        <div className="card">
          <h2 className="font-heading text-xl font-semibold mb-6 text-center">
            Welcome Back
          </h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 text-sm mb-4">
              {decodeURIComponent(error.replace(/\+/g, " "))}
            </div>
          )}

          <form method="POST" action="/api/auth/login" className="space-y-4">
            <div>
              <label className="block text-text-secondary text-sm mb-1">Email</label>
              <input
                className="input"
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-text-secondary text-sm mb-1">
                Password
              </label>
              <input
                className="input"
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </div>

            <button type="submit" className="btn-primary w-full">
              Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
