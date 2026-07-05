export async function askJarvis(message: string, model = "llama3.2:3b") {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, model }),
  });

  if (!res.ok) {
    throw new Error(`Jarvis failed: ${res.status}`);
  }

  return res.json();
}
