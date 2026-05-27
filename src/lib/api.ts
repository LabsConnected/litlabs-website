const API_BASE = "https://api.litlabs.net";

async function fetchApi(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getHealth() {
  return fetchApi("/health");
}

export async function getStatus() {
  return fetchApi("/api/status");
}

export async function getFiles(dir?: string) {
  const q = dir ? `?dir=${encodeURIComponent(dir)}` : "";
  return fetchApi(`/api/files${q}`);
}

export async function runCommand(cmd: string) {
  return fetchApi("/api/run", {
    method: "POST",
    body: JSON.stringify({ cmd }),
  });
}
