import { ImageResponse } from "next/og";
import { SITE_URL } from "@/lib/siteConfig";

export const runtime = "edge";
const size = { width: 1200, height: 630 };

export function GET() {
  return new ImageResponse(
    <div
      style={{
        background:
          "linear-gradient(135deg, #0a0a0f 0%, #0d0d1a 50%, #0f0a1a 100%)",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Grid pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(63,63,70,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(63,63,70,0.15) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Glow */}
      <div
        style={{
          position: "absolute",
          top: -100,
          left: -100,
          width: 600,
          height: 600,
          background:
            "radial-gradient(circle, rgba(210,168,255,0.15) 0%, transparent 70%)",
          borderRadius: "50%",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -100,
          right: -100,
          width: 500,
          height: 500,
          background:
            "radial-gradient(circle, rgba(121,192,255,0.12) 0%, transparent 70%)",
          borderRadius: "50%",
        }}
      />

      {/* Content */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            background: "linear-gradient(135deg, #d2a8ff, #ff7b72)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
          }}
        >
          ⚡
        </div>
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#71717a",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          LiTTree LabStudios
        </span>
      </div>

      <h1
        style={{
          fontSize: 64,
          fontWeight: 900,
          color: "#d4d4d8",
          textAlign: "center",
          margin: "0 0 24px 0",
          lineHeight: 1.1,
          maxWidth: 900,
        }}
      >
        Your <span style={{ color: "#d2a8ff" }}>AI Agent</span> Platform
      </h1>

      <p
        style={{
          fontSize: 24,
          color: "#71717a",
          textAlign: "center",
          maxWidth: 700,
          margin: 0,
        }}
      >
        Deploy AI agents · Build workflows · Automate everything
      </p>

      <div style={{ display: "flex", gap: 16, marginTop: 48 }}>
        {["6 AI Agents", "No-Code Builder", "Free Beta"].map((tag) => (
          <div
            key={tag}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "1px solid rgba(210,168,255,0.3)",
              color: "#d2a8ff",
              fontSize: 16,
              fontWeight: 600,
              background: "rgba(210,168,255,0.08)",
            }}
          >
            {tag}
          </div>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 32,
          color: "#3f3f46",
          fontSize: 16,
        }}
      >
        {new URL(SITE_URL).hostname} · AI Platform
      </div>
    </div>,
    size,
  );
}
