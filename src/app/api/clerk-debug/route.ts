import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  let outboundIp = "(unknown)";
  try {
    const res = await fetch("https://api.ipify.org");
    outboundIp = await res.text();
  } catch (e) {
    outboundIp = "error: " + (e as Error).message;
  }

  // Test if Railway can reach clerk.litlabs.net (the FAPI)
  let clerkFapiStatus = "(unknown)";
  let clerkFapiBody = "";
  try {
    const res = await fetch("https://clerk.litlabs.net/v1/environment");
    clerkFapiStatus = `${res.status} ${res.statusText}`;
    const text = await res.text();
    clerkFapiBody = text.substring(0, 200);
  } catch (e) {
    clerkFapiStatus = "error: " + (e as Error).message;
  }

  // Test if Railway can load clerk.browser.js from clerk.litlabs.net
  let clerkJsStatus = "(unknown)";
  let clerkJsLength = 0;
  try {
    const res = await fetch("https://clerk.litlabs.net/npm/@clerk/clerk-js@6/dist/clerk.browser.js");
    clerkJsStatus = `${res.status} ${res.statusText}`;
    const text = await res.text();
    clerkJsLength = text.length;
  } catch (e) {
    clerkJsStatus = "error: " + (e as Error).message;
  }

  // Test if Railway can load a chunk from clerk.litlabs.net
  let chunkStatus = "(unknown)";
  try {
    const res = await fetch("https://clerk.litlabs.net/npm/@clerk/clerk-js@6.30.1/dist/stripe-vendors_clerk.browser_ceaf9caaf580d8ce_6.30.1.js");
    chunkStatus = `${res.status} ${res.statusText}`;
  } catch (e) {
    chunkStatus = "error: " + (e as Error).message;
  }

  // Test if Railway can reach frontend-api.clerk.dev
  let defaultFapiStatus = "(unknown)";
  try {
    const res = await fetch("https://frontend-api.clerk.dev/v1/environment");
    defaultFapiStatus = `${res.status} ${res.statusText}`;
  } catch (e) {
    defaultFapiStatus = "error: " + (e as Error).message;
  }

  return NextResponse.json({
    outboundIp,
    clerkFapiStatus,
    clerkFapiBody,
    clerkJsStatus,
    clerkJsLength,
    chunkStatus,
    defaultFapiStatus,
    CLERK_FAPI_URL: process.env.CLERK_FAPI_URL || "(not set)",
    NEXT_PUBLIC_CLERK_PROXY_URL: process.env.NEXT_PUBLIC_CLERK_PROXY_URL || "(not set)",
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: JSON.stringify(process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL),
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: JSON.stringify(process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL),
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: JSON.stringify(process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL),
    NODE_ENV: process.env.NODE_ENV,
  });
}
