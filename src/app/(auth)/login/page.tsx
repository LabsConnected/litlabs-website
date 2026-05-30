export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error || null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-cyber-bg p-6 relative overflow-hidden selection:bg-neon-cyan/30">
      {/* Background glow effects */}
      <div className="absolute top-[-10%] left-[-5%] w-[600px] h-[600px] bg-neon-cyan/10 rounded-full blur-[120px] pointer-events-none animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] bg-neon-purple/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-block text-[10px] font-bold text-neon-cyan tracking-[0.4em] uppercase mb-4">Secure_Node_Entry</div>
          <h1 className="font-heading text-4xl sm:text-5xl font-bold tracking-tighter text-neon-cyan text-glow-cyan mb-2">
            LITLABS<span className="text-neon-purple">.AI</span>
          </h1>
          <p className="text-text-muted text-[10px] font-bold tracking-[0.2em] uppercase opacity-60">
            Autonomous_Media_Social_Engine
          </p>
        </div>

        {/* Card */}
        <div className="card p-8 sm:p-10 border-neon-cyan/10 bg-black/40 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-neon-cyan/20 to-transparent" />
          
          <h2 className="font-heading text-xl font-bold mb-8 text-center uppercase tracking-tight">
            Initialize_Session
          </h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-xs font-bold uppercase tracking-wider mb-6 flex items-center gap-3">
              <span className="text-lg shrink-0">⚠</span>
              <span>{decodeURIComponent(error.replace(/\+/g, " "))}</span>
            </div>
          )}

          <form method="POST" action="/api/auth/login" className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-2 px-1">
                Auth_Identifier
              </label>
              <input
                id="email"
                className="input text-base font-medium"
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="USER_ID@DOMAIN.EXE"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-2 px-1">
                Access_Credential
              </label>
              <input
                id="password"
                className="input text-base font-medium"
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder="••••••••••••"
              />
            </div>

            <button type="submit" className="btn-primary w-full py-4 text-sm uppercase tracking-[0.2em] font-bold mt-2">
              Authorize_Entry
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-white/5 text-center">
            <p className="text-text-muted text-[10px] font-bold tracking-widest uppercase opacity-40">
              System_v3.0.4_Encrypted
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
