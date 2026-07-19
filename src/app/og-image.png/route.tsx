import { ImageResponse } from "next/og";
import { SITE_URL } from "@/lib/siteConfig";

export const runtime = "edge";
const size = { width: 1200, height: 630 };

export function GET() {
  return new ImageResponse(
    <div
      style={{
        background: "#f4f1e8",
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
            "linear-gradient(rgba(17,18,15,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(17,18,15,0.08) 1px, transparent 1px)",
          backgroundSize: "70px 70px",
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
            "radial-gradient(circle, rgba(117,89,255,0.2) 0%, transparent 70%)",
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
            "radial-gradient(circle, rgba(200,255,61,0.35) 0%, transparent 70%)",
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
            background: "#c8ff3d",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
          }}
        >
          ✦
        </div>
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#11120f",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          LiTTree Labs
        </span>
      </div>

      <h1
        style={{
          fontSize: 64,
          fontWeight: 900,
          color: "#11120f",
          textAlign: "center",
          margin: "0 0 24px 0",
          lineHeight: 1.1,
          maxWidth: 900,
        }}
      >
        Your AI crew. <span style={{ color: "#7559ff" }}>Always building.</span>
      </h1>

      <p
        style={{
          fontSize: 24,
          color: "rgba(17,18,15,0.62)",
          textAlign: "center",
          maxWidth: 700,
          margin: 0,
        }}
      >
        Specialized agents, creative tools, and automated workflows in one connected workspace.
      </p>

      <div style={{ display: "flex", gap: 16, marginTop: 48 }}>
        {["Agents", "Studio", "Automations", "Marketplace"].map((tag) => (
          <div
            key={tag}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "1px solid rgba(17,18,15,0.25)",
              color: "#11120f",
              fontSize: 16,
              fontWeight: 600,
              background: "rgba(255,255,255,0.5)",
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
          color: "rgba(17,18,15,0.45)",
          fontSize: 16,
        }}
      >
        {new URL(SITE_URL).hostname} · Your AI crew
      </div>
    </div>,
    size,
  );
}
