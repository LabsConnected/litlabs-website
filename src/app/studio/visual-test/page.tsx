"use client";

/**
 * VisualTestHarness — renders the REAL Studio sub-components with
 * mocked data for visual testing.
 *
 * Security gates:
 * - Returns 404 in production
 * - Returns 404 unless NEXT_PUBLIC_VISUAL_TEST=1 env flag is set
 * - No authentication bypass
 * - No production secrets
 * - No live AI, terminal, deployment, or write API calls
 *
 * The harness pre-populates Zustand stores with mock data and wraps
 * components in a mock VoiceSessionContext.Provider so the real
 * components render without making any network requests.
 */

import { useState, useEffect } from "react";
import { VoiceSessionContext, defaultCtx as defaultVoiceCtx } from "../context/VoiceSessionContext";
import { useStudioAgentStore, AGENT_META, type AgentId } from "../stores/useStudioAgentStore";
import type { StudioMessage } from "../types/conversation";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import { useTerminalStore } from "@/stores/useTerminalStore";
import StudioTranscript from "../components/StudioTranscript";
import CommandComposer from "../components/CommandComposer";
import MockStudioHeader from "./MockStudioHeader";
import { StudioInspector, StudioDrawer } from "../components/StudioWorkspaceFrame";
import LiTEmptyState from "../components/LiTEmptyState";
import { useTheme } from "@/context/ThemeContext";
import type { InspectorTab, DrawerTab } from "../lib/studio-destinations";
import {
  MOCK_MESSAGES,
  MOCK_BUSY_MESSAGES,
  MOCK_SPARK_MESSAGES,
  MOCK_CAPABILITIES,
  MOCK_CAPABILITIES_DISCONNECTED,
  VISUAL_TEST_STATES,
  type VisualTestState,
} from "./mock-data";

// ── Mock Voice Session Context ──────────────────────────────────
const mockVoiceCtx: typeof defaultVoiceCtx = {
  ...defaultVoiceCtx,
  voiceTransportConnected: true,
};

// ── Pre-populate stores ─────────────────────────────────────────
function useMockStores(activeAgentId: AgentId) {
  useEffect(() => {
    // Pre-populate terminal store
    useTerminalStore.setState({
      status: "connected",
      sessionId: "pty-visual-test",
      error: null,
    });
    // Pre-populate agent store
    useStudioAgentStore.setState({
      activeAgentId,
      threads: { litt: [], spark: [] },
    });
    // Pre-populate model store
    useStudioModelStore.setState({
      selectedModel: {
        id: "auto",
        label: "Auto Best",
        provider: "auto",
        name: "Auto Best",
        model: "",
        cost: "free" as const,
        speed: "fast" as const,
        icon: "sparkles",
        apiProvider: "",
        category: "auto" as const,
      },
      fallbackNotice: null,
      providerHealth: {},
    });
  }, [activeAgentId]);
}

// ── State selector ──────────────────────────────────────────────
function getMessagesForState(state: VisualTestState): StudioMessage[] {
  switch (state) {
    case "empty":
    case "inspector":
    case "activity-drawer":
    case "terminal-drawer":
    case "camera":
    case "mobile-composer":
      return [];
    case "busy":
      return MOCK_BUSY_MESSAGES;
    case "spark":
      return MOCK_SPARK_MESSAGES;
    default:
      return MOCK_MESSAGES;
  }
}

function getAgentForState(state: VisualTestState): AgentId {
  return state === "spark" ? "spark" : "litt";
}

function getBusyForState(state: VisualTestState): boolean {
  return state === "busy";
}

// ── Main harness component ──────────────────────────────────────
function VisualTestHarness() {
  const { tokens } = useTheme();
  const [state, setState] = useState<VisualTestState>("empty");
  const [composerValue, setComposerValue] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("activity");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("plan");
  const [cameraOpen, setCameraOpen] = useState(false);

  const activeAgentId = getAgentForState(state);
  useMockStores(activeAgentId);

  // Sync UI state with selected visual test state
  useEffect(() => {
    setInspectorOpen(state === "inspector");
    setDrawerOpen(state === "activity-drawer" || state === "terminal-drawer");
    setDrawerTab(state === "terminal-drawer" ? "terminal" : "activity");
    setCameraOpen(state === "camera");
  }, [state]);

  const messages = getMessagesForState(state);
  const busy = getBusyForState(state);
  const isMobile = state === "mobile-conversation" || state === "mobile-composer";
  const capabilities = state === "empty" ? MOCK_CAPABILITIES_DISCONNECTED : MOCK_CAPABILITIES;
  const agentMeta = AGENT_META[activeAgentId];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: isMobile ? "390px" : "100%",
        margin: isMobile ? "0 auto" : "0",
        backgroundColor: tokens.background,
        color: tokens.text,
        overflow: "hidden",
        border: isMobile ? "1px solid var(--studio-border)" : "none",
      }}
    >
      {/* State selector bar — dev only, not part of the real UI */}
      <div
        data-testid="visual-test-state-selector"
        style={{
          display: "flex",
          gap: 4,
          padding: "4px 8px",
          backgroundColor: "rgba(0,0,0,0.4)",
          borderBottom: "1px solid var(--studio-border)",
          overflowX: "auto",
          flexShrink: 0,
          fontSize: 10,
          zIndex: 100,
        }}
      >
        {VISUAL_TEST_STATES.map((s) => (
          <button
            key={s.id}
            type="button"
            data-visual-state={s.id}
            onClick={() => setState(s.id)}
            style={{
              padding: "2px 6px",
              borderRadius: 4,
              border: "none",
              backgroundColor: state === s.id ? "var(--litt-primary)" : "transparent",
              color: state === s.id ? "#000" : "var(--text-muted)",
              fontWeight: 700,
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Mock header — visual replica without Clerk dependency */}
      <MockStudioHeader
        onPreview={() => {}}
        onOpenActivity={() => {
          setDrawerOpen(true);
          setDrawerTab("activity");
        }}
        projectReady={capabilities.repository === "connected"}
        capabilities={capabilities}
        branch="main"
      />

      {/* Main workspace area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        {/* Center: transcript + composer */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Transcript area */}
          <div style={{ flex: 1, overflow: "auto", padding: "16px 12px" }}>
            {messages.length === 0 && !busy ? (
              <LiTEmptyState
                hasProject={capabilities.repository === "connected"}
                onPick={(prompt: string) => setComposerValue(prompt)}
              />
            ) : (
              <StudioTranscript
                messages={messages}
                busy={busy}
                activeAgentId={activeAgentId}
                onRouteTool={() => {}}
                onRegenerate={() => {}}
              />
            )}
          </div>

          {/* Real drawer */}
          <StudioDrawer
            open={drawerOpen}
            onToggle={() => setDrawerOpen((v) => !v)}
            activeTab={drawerTab}
            onTabChange={(t) => setDrawerTab(t)}
          >
            {drawerTab === "activity" ? (
              <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Activity Log</div>
                <div style={{ opacity: 0.7, marginBottom: 4 }}>• Connected to repository litlabs-website</div>
                <div style={{ opacity: 0.7, marginBottom: 4 }}>• Terminal session started</div>
                <div style={{ opacity: 0.7 }}>• LiTT generated hero section</div>
              </div>
            ) : (
              <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontFamily: "monospace" }}>$ pnpm dev</div>
                <div style={{ fontFamily: "monospace", opacity: 0.7 }}>
                  ▲ Next.js 16.2.10 (Turbopack)
                  <br />✓ Ready in 1395ms
                  <br />- Local: http://localhost:3000
                </div>
              </div>
            )}
          </StudioDrawer>

          {/* Camera overlay */}
          {cameraOpen && (
            <div
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                width: 240,
                height: 180,
                borderRadius: 12,
                backgroundColor: "#000",
                border: "2px solid var(--studio-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 50,
              }}
            >
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Camera Preview</div>
              <button
                type="button"
                onClick={() => setCameraOpen(false)}
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  padding: "2px 6px",
                  fontSize: 10,
                  borderRadius: 4,
                  border: "none",
                  backgroundColor: "rgba(255,255,255,0.1)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Real composer */}
          <CommandComposer
            value={composerValue}
            onChange={setComposerValue}
            onSend={async () => ({ accepted: true })}
            busy={busy}
            onToggleCamera={() => setCameraOpen((v) => !v)}
            cameraActive={cameraOpen}
            contextLine={{
              repo: capabilities.repositoryName ?? undefined,
              branch: capabilities.repository === "connected" ? "main" : undefined,
            }}
          />
        </div>

        {/* Right: real inspector */}
        <StudioInspector
          open={inspectorOpen}
          onToggle={() => setInspectorOpen((v) => !v)}
          activeTab={inspectorTab}
          onTabChange={(t) => setInspectorTab(t)}
        >
          <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Plan</div>
            <div style={{ opacity: 0.7 }}>
              1. Hero section with CTA ✓
              <br />2. Menu showcase
              <br />3. About section
              <br />4. Location & hours
            </div>
          </div>
        </StudioInspector>
      </div>
    </div>
  );
}

// ── Page export with env gate ───────────────────────────────────
export default function VisualTestPage() {
  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Gate: 404 in production, require NEXT_PUBLIC_VISUAL_TEST=1 flag
    const isProduction = process.env.NODE_ENV === "production";
    const visualTestEnabled = process.env.NEXT_PUBLIC_VISUAL_TEST === "1";
    setAllowed(!isProduction && visualTestEnabled);
    setChecked(true);
  }, []);

  if (!checked) return null;

  if (!allowed) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh" }}>
        <h1>404 — Not Found</h1>
      </div>
    );
  }

  return (
    <VoiceSessionContext.Provider value={mockVoiceCtx}>
      <VisualTestHarness />
    </VoiceSessionContext.Provider>
  );
}
