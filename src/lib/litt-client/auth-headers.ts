/**
 * Clerk bearer headers for Studio conversation fetches.
 *
 * Same shape as `authHeaders` inside `useCanonicalConversation`: a JSON
 * content type only when the caller asks for it, and `Authorization`
 * only when Clerk actually returns a token. Cookie auth still rides
 * along via `credentials: "include"` at the fetch call.
 */
export async function littAuthHeaders(
  getToken: (() => Promise<string | null>) | undefined,
  json = false,
): Promise<HeadersInit> {
  const token = await getToken?.();
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
