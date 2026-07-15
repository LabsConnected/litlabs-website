export async function askLiTT(message: string, model = "llama3.2:3b") {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, model }),
  });

  if (!res.ok) {
    throw new Error(`LiTT failed: ${res.status}`);
  }

  return res.json();
}
