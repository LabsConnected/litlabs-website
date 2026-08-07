import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") || "LiTTree Lab Studios";
  const description =
    searchParams.get("description") ||
    "AI creative studio powered by LiTT and Spark";

  try {
    return new ImageResponse(
      (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
            color: "white",
            fontFamily: "system-ui, sans-serif",
            padding: "80px 60px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
              marginBottom: "40px",
            }}
          >
            <div
              style={{
                width: "80px",
                height: "80px",
                borderRadius: "20px",
                background: "linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "48px",
                fontWeight: "bold",
              }}
            >
              L
            </div>
            <div style={{ fontSize: "48px", fontWeight: "800", letterSpacing: "-0.02em" }}>
              LiTTree Lab Studios
            </div>
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: "500",
              color: "#cbd5e1",
              textAlign: "center",
              maxWidth: "900px",
              lineHeight: 1.4,
            }}
          >
            {description}
          </div>
          <div
            style={{
              marginTop: "60px",
              display: "flex",
              gap: "24px",
              fontSize: "18px",
              color: "#94a3b8",
            }}
          >
            <span>AI Chat</span>
            <span>•</span>
            <span>Media Generation</span>
            <span>•</span>
            <span>Autonomous Agents</span>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      },
    );
  } catch (e) {
    console.error("OG image generation failed", e);
    return new Response("Failed to generate image", { status: 500 });
  }
}

