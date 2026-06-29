"use client";

export default function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cyber-bg p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="h-9 w-40 bg-cyber-surface-2 rounded mx-auto mb-2 animate-pulse" />
          <div className="h-3 w-56 bg-cyber-surface-2 rounded mx-auto animate-pulse" />
        </div>
        <div className="h-64 bg-cyber-surface rounded-xl border border-cyber-border animate-pulse" />
      </div>
    </div>
  );
}
