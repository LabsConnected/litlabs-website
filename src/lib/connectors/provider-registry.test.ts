import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PLATFORM_PROVIDERS,
  USER_CONNECTION_PROVIDERS,
  CAPABILITY_DEFINITIONS,
  ALL_PROVIDERS,
  isConnectorEnabled,
  CONNECTOR_FEATURE_FLAGS,
} from "@/lib/connectors/provider-registry";

describe("provider-registry", () => {
  describe("PLATFORM_PROVIDERS", () => {
    it("includes open_meteo with weather capabilities", () => {
      expect(PLATFORM_PROVIDERS.open_meteo).toBeDefined();
      expect(PLATFORM_PROVIDERS.open_meteo.category).toBe("platform");
      expect(PLATFORM_PROVIDERS.open_meteo.capabilities).toContain("weather.current");
      expect(PLATFORM_PROVIDERS.open_meteo.capabilities).toContain("weather.hourly");
      expect(PLATFORM_PROVIDERS.open_meteo.capabilities).toContain("weather.daily");
      expect(PLATFORM_PROVIDERS.open_meteo.capabilities).toContain("weather.geocode");
    });

    it("includes brave_search with search capabilities", () => {
      expect(PLATFORM_PROVIDERS.brave_search).toBeDefined();
      expect(PLATFORM_PROVIDERS.brave_search.capabilities).toContain("web.search");
      expect(PLATFORM_PROVIDERS.brave_search.capabilities).toContain("news.search");
      expect(PLATFORM_PROVIDERS.brave_search.capabilities).toContain("places.search");
    });

    it("includes firecrawl with web fetch capabilities", () => {
      expect(PLATFORM_PROVIDERS.firecrawl).toBeDefined();
      expect(PLATFORM_PROVIDERS.firecrawl.capabilities).toContain("web.fetch");
      expect(PLATFORM_PROVIDERS.firecrawl.capabilities).toContain("web.extract");
      expect(PLATFORM_PROVIDERS.firecrawl.capabilities).toContain("web.map_site");
    });

    it("includes nango as a platform provider", () => {
      expect(PLATFORM_PROVIDERS.nango).toBeDefined();
      expect(PLATFORM_PROVIDERS.nango.category).toBe("platform");
    });

    it("all platform providers have envVars and description", () => {
      for (const [, def] of Object.entries(PLATFORM_PROVIDERS)) {
        expect(def.envVars).toBeInstanceOf(Array);
        expect(def.description).toBeTruthy();
        expect(def.category).toBe("platform");
      }
    });
  });

  describe("USER_CONNECTION_PROVIDERS", () => {
    it("includes google with calendar and gmail capabilities", () => {
      expect(USER_CONNECTION_PROVIDERS.google).toBeDefined();
      expect(USER_CONNECTION_PROVIDERS.google.category).toBe("user_connection");
      expect(USER_CONNECTION_PROVIDERS.google.capabilities).toContain("google_calendar_read");
      expect(USER_CONNECTION_PROVIDERS.google.capabilities).toContain("gmail_metadata");
      expect(USER_CONNECTION_PROVIDERS.google.capabilities).toContain("gmail_send");
    });

    it("includes microsoft with calendar and mail capabilities", () => {
      expect(USER_CONNECTION_PROVIDERS.microsoft).toBeDefined();
      expect(USER_CONNECTION_PROVIDERS.microsoft.capabilities).toContain("microsoft_calendar_read");
      expect(USER_CONNECTION_PROVIDERS.microsoft.capabilities).toContain("microsoft_mail_read");
    });

    it("includes github, meta, slack, notion, dropbox", () => {
      expect(USER_CONNECTION_PROVIDERS.github).toBeDefined();
      expect(USER_CONNECTION_PROVIDERS.meta).toBeDefined();
      expect(USER_CONNECTION_PROVIDERS.slack).toBeDefined();
      expect(USER_CONNECTION_PROVIDERS.notion).toBeDefined();
      expect(USER_CONNECTION_PROVIDERS.dropbox).toBeDefined();
    });

    it("all user connection providers have category user_connection", () => {
      for (const [, def] of Object.entries(USER_CONNECTION_PROVIDERS)) {
        expect(def.category).toBe("user_connection");
      }
    });
  });

  describe("ALL_PROVIDERS", () => {
    it("combines platform and user connection providers", () => {
      expect(Object.keys(ALL_PROVIDERS).length).toBeGreaterThan(
        Object.keys(PLATFORM_PROVIDERS).length,
      );
      expect(ALL_PROVIDERS.open_meteo).toBeDefined();
      expect(ALL_PROVIDERS.google).toBeDefined();
    });
  });

  describe("CAPABILITY_DEFINITIONS", () => {
    it("defines weather capabilities with none permission", () => {
      expect(CAPABILITY_DEFINITIONS["weather.current"].permission).toBe("none");
      expect(CAPABILITY_DEFINITIONS["weather.current"].mutation).toBe(false);
    });

    it("defines web search with none permission", () => {
      expect(CAPABILITY_DEFINITIONS["web.search"].permission).toBe("none");
      expect(CAPABILITY_DEFINITIONS["web.search"].mutation).toBe(false);
    });

    it("defines google_calendar_read as connection_consent", () => {
      expect(CAPABILITY_DEFINITIONS["google_calendar_read"].permission).toBe("connection_consent");
      expect(CAPABILITY_DEFINITIONS["google_calendar_read"].mutation).toBe(false);
    });

    it("defines google_calendar_write as explicit_approval", () => {
      expect(CAPABILITY_DEFINITIONS["google_calendar_write"].permission).toBe("explicit_approval");
      expect(CAPABILITY_DEFINITIONS["google_calendar_write"].mutation).toBe(true);
    });

    it("defines gmail_send as explicit_approval", () => {
      expect(CAPABILITY_DEFINITIONS["gmail_send"].permission).toBe("explicit_approval");
      expect(CAPABILITY_DEFINITIONS["gmail_send"].mutation).toBe(true);
    });

    it("defines gmail_read as sensitive_access", () => {
      expect(CAPABILITY_DEFINITIONS["gmail_read"].permission).toBe("sensitive_access");
    });

    it("defines gmail_draft as connection_consent", () => {
      expect(CAPABILITY_DEFINITIONS["gmail_draft"].permission).toBe("connection_consent");
    });

    it("defines microsoft_calendar_write as explicit_approval", () => {
      expect(CAPABILITY_DEFINITIONS["microsoft_calendar_write"].permission).toBe("explicit_approval");
      expect(CAPABILITY_DEFINITIONS["microsoft_calendar_write"].mutation).toBe(true);
    });

    it("defines microsoft_mail_send as explicit_approval", () => {
      expect(CAPABILITY_DEFINITIONS["microsoft_mail_send"].permission).toBe("explicit_approval");
    });

    it("all capability definitions have required fields", () => {
      for (const [, def] of Object.entries(CAPABILITY_DEFINITIONS)) {
        expect(def.id).toBeTruthy();
        expect(def.label).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.permission).toBeTruthy();
        expect(def.provider).toBeTruthy();
        expect(typeof def.mutation).toBe("boolean");
      }
    });
  });

  describe("CONNECTOR_FEATURE_FLAGS", () => {
    it("defines all expected feature flags", () => {
      expect(CONNECTOR_FEATURE_FLAGS.weather).toBeDefined();
      expect(CONNECTOR_FEATURE_FLAGS.web_search).toBeDefined();
      expect(CONNECTOR_FEATURE_FLAGS.google_calendar).toBeDefined();
      expect(CONNECTOR_FEATURE_FLAGS.gmail).toBeDefined();
      expect(CONNECTOR_FEATURE_FLAGS.microsoft_graph).toBeDefined();
      expect(CONNECTOR_FEATURE_FLAGS.daily_briefing).toBeDefined();
    });

    it("each flag has public and server env var names", () => {
      for (const [, flag] of Object.entries(CONNECTOR_FEATURE_FLAGS)) {
        expect(flag.publicVar).toMatch(/^NEXT_PUBLIC_/);
        expect(flag.serverVar).not.toMatch(/^NEXT_PUBLIC_/);
      }
    });
  });

  describe("isConnectorEnabled", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("returns false by default when no env vars are set", () => {
      vi.stubEnv("NEXT_PUBLIC_WEATHER_ENABLED", undefined);
      vi.stubEnv("WEATHER_ENABLED", undefined);
      expect(isConnectorEnabled("weather")).toBe(false);
    });

    it("returns true when NEXT_PUBLIC flag is true", () => {
      vi.stubEnv("NEXT_PUBLIC_WEATHER_ENABLED", "true");
      expect(isConnectorEnabled("weather")).toBe(true);
    });

    it("returns false when NEXT_PUBLIC flag is false", () => {
      vi.stubEnv("NEXT_PUBLIC_WEATHER_ENABLED", "false");
      expect(isConnectorEnabled("weather")).toBe(false);
    });

    it("returns true when server-only flag is true and public is unset", () => {
      vi.stubEnv("NEXT_PUBLIC_WEATHER_ENABLED", undefined);
      vi.stubEnv("WEATHER_ENABLED", "true");
      expect(isConnectorEnabled("weather")).toBe(true);
    });

    it("public flag takes precedence over server flag", () => {
      vi.stubEnv("NEXT_PUBLIC_WEATHER_ENABLED", "false");
      vi.stubEnv("WEATHER_ENABLED", "true");
      expect(isConnectorEnabled("weather")).toBe(false);
    });
  });
});
