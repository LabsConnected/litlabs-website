export type ChatSearchParams = Record<string, string | string[] | undefined>;

export function buildChatRedirectUrl(incoming: ChatSearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  params.set("tool", "chat");
  return `/studio?${params.toString()}`;
}
