"use client";

import { useClerkAuthContext } from "@/context/ClerkAuthContext";

export function useClerkAuth() {
  return useClerkAuthContext();
}
