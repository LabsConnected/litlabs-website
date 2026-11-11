"use client";

import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-dvh flex items-center justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-16" style={{ backgroundColor: "#f6f9f1", color: "#0e1510" }}>
          <div className="max-w-md w-full rounded-xl p-8" style={{ border: "1px solid #cfdec4", backgroundColor: "#ffffff" }}>
            <div className="text-center mb-6">
              <AlertTriangle size={48} className="mx-auto mb-4" style={{ color: "#ef4444" }} />
              <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
              <p className="text-sm opacity-60">
                {this.state.error?.message || "An unexpected error occurred"}
              </p>
            </div>

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg hover:opacity-90 transition-opacity"
                style={{ backgroundColor: "#177a36", color: "#fff" }}
              >
                <RefreshCw size={14} />
                Try Again
              </button>
              <Link
                href="/"
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg hover:opacity-90 transition-opacity"
                style={{ backgroundColor: "transparent", color: "#63745f", border: "1px solid #cfdec4", textDecoration: "none" }}
              >
                <Home size={14} />
                Go Home
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
