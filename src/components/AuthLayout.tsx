"use client";
import { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cyber-bg p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-heading text-3xl font-bold gradient-text mb-2">LiTreeLabStudios</h1>
          <p className="text-text-muted text-sm font-code tracking-widest">AI-NATIVE WORKSPACE</p>
        </div>
        <div className="card">{children}</div>
      </div>
    </div>
  );
}
