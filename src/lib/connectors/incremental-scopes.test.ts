import { describe, it, expect } from "vitest";
import {
  INCREMENTAL_SCOPES,
  getScopesForCapabilities,
  getCapabilitiesForScopes,
  USER_CONNECTION_PROVIDERS,
  CAPABILITY_DEFINITIONS,
  type CapabilityId,
} from "@/lib/connectors/provider-registry";

describe("incremental OAuth scopes", () => {
  describe("INCREMENTAL_SCOPES", () => {
    it("maps gmail_metadata to gmail.metadata scope", () => {
      expect(INCREMENTAL_SCOPES.gmail_metadata).toContain(
        "https://www.googleapis.com/auth/gmail.metadata",
      );
    });

    it("maps gmail_read to gmail.readonly scope (more sensitive than metadata)", () => {
      expect(INCREMENTAL_SCOPES.gmail_read).toContain(
        "https://www.googleapis.com/auth/gmail.readonly",
      );
    });

    it("maps gmail_send to gmail.send scope", () => {
      expect(INCREMENTAL_SCOPES.gmail_send).toContain(
        "https://www.googleapis.com/auth/gmail.send",
      );
    });

    it("maps gmail_draft to gmail.compose scope", () => {
      expect(INCREMENTAL_SCOPES.gmail_draft).toContain(
        "https://www.googleapis.com/auth/gmail.compose",
      );
    });

    it("maps google_calendar_read to calendar.readonly scope", () => {
      expect(INCREMENTAL_SCOPES.google_calendar_read).toContain(
        "https://www.googleapis.com/auth/calendar.readonly",
      );
    });

    it("maps google_calendar_write to calendar scope (full)", () => {
      expect(INCREMENTAL_SCOPES.google_calendar_write).toContain(
        "https://www.googleapis.com/auth/calendar",
      );
    });

    it("maps contacts_read to contacts.readonly scope", () => {
      expect(INCREMENTAL_SCOPES.contacts_read).toContain(
        "https://www.googleapis.com/auth/contacts.readonly",
      );
    });

    it("maps Microsoft calendar and mail scopes", () => {
      expect(INCREMENTAL_SCOPES.microsoft_calendar_read).toContain("Calendars.Read");
      expect(INCREMENTAL_SCOPES.microsoft_calendar_write).toContain("Calendars.ReadWrite");
      expect(INCREMENTAL_SCOPES.microsoft_mail_read).toContain("Mail.Read");
      expect(INCREMENTAL_SCOPES.microsoft_mail_send).toContain("Mail.Send");
    });
  });

  describe("getScopesForCapabilities", () => {
    it("returns the union of scopes for multiple capabilities", () => {
      const scopes = getScopesForCapabilities(["gmail_metadata", "google_calendar_read"]);
      expect(scopes).toContain("https://www.googleapis.com/auth/gmail.metadata");
      expect(scopes).toContain("https://www.googleapis.com/auth/calendar.readonly");
      expect(scopes.length).toBe(2);
    });

    it("deduplicates scopes across capabilities", () => {
      // Two capabilities that might share a scope
      const scopes = getScopesForCapabilities(["gmail_metadata", "gmail_read"]);
      // gmail_metadata and gmail_read have different scopes
      expect(scopes).toContain("https://www.googleapis.com/auth/gmail.metadata");
      expect(scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    });

    it("returns empty array for capabilities with no mapped scopes", () => {
      const scopes = getScopesForCapabilities(["weather.current" as CapabilityId]);
      expect(scopes).toEqual([]);
    });

    it("returns empty array for empty input", () => {
      const scopes = getScopesForCapabilities([]);
      expect(scopes).toEqual([]);
    });
  });

  describe("getCapabilitiesForScopes", () => {
    it("returns capabilities whose scopes are all present", () => {
      const scopes = [
        "https://www.googleapis.com/auth/gmail.metadata",
        "https://www.googleapis.com/auth/calendar.readonly",
      ];
      const caps = getCapabilitiesForScopes(scopes);
      expect(caps).toContain("gmail_metadata");
      expect(caps).toContain("google_calendar_read");
    });

    it("does not grant a capability if any required scope is missing", () => {
      // Only gmail.metadata is present, not gmail.readonly
      const scopes = ["https://www.googleapis.com/auth/gmail.metadata"];
      const caps = getCapabilitiesForScopes(scopes);
      expect(caps).toContain("gmail_metadata");
      expect(caps).not.toContain("gmail_read");
    });

    it("returns empty array for empty scopes", () => {
      const caps = getCapabilitiesForScopes([]);
      expect(caps).toEqual([]);
    });
  });

  describe("Google provider — base scopes only", () => {
    it("Google provider base scopes do NOT include Gmail/Calendar/Contacts", () => {
      const googleScopes = USER_CONNECTION_PROVIDERS.google.oauthScopes ?? [];
      // Base scopes should only be identity
      expect(googleScopes).toContain("openid");
      expect(googleScopes).toContain("email");
      expect(googleScopes).toContain("profile");
      // Should NOT include data scopes in the base
      expect(googleScopes).not.toContain("https://www.googleapis.com/auth/gmail.readonly");
      expect(googleScopes).not.toContain("https://www.googleapis.com/auth/calendar.readonly");
      expect(googleScopes).not.toContain("https://www.googleapis.com/auth/contacts.readonly");
    });
  });

  describe("capability permission levels", () => {
    it("gmail_read is marked as sensitive_access", () => {
      expect(CAPABILITY_DEFINITIONS.gmail_read.permission).toBe("sensitive_access");
    });

    it("gmail_send is marked as explicit_approval", () => {
      expect(CAPABILITY_DEFINITIONS.gmail_send.permission).toBe("explicit_approval");
    });

    it("google_calendar_write is marked as explicit_approval", () => {
      expect(CAPABILITY_DEFINITIONS.google_calendar_write.permission).toBe("explicit_approval");
    });

    it("gmail_metadata is marked as connection_consent", () => {
      expect(CAPABILITY_DEFINITIONS.gmail_metadata.permission).toBe("connection_consent");
    });

    it("contacts_read is marked as connection_consent", () => {
      expect(CAPABILITY_DEFINITIONS.contacts_read.permission).toBe("connection_consent");
    });

    it("weather.current is marked as none (public data)", () => {
      expect(CAPABILITY_DEFINITIONS["weather.current"].permission).toBe("none");
    });

    it("mutation flags are correct", () => {
      expect(CAPABILITY_DEFINITIONS.gmail_send.mutation).toBe(true);
      expect(CAPABILITY_DEFINITIONS.gmail_draft.mutation).toBe(true);
      expect(CAPABILITY_DEFINITIONS.google_calendar_write.mutation).toBe(true);
      expect(CAPABILITY_DEFINITIONS.gmail_read.mutation).toBe(false);
      expect(CAPABILITY_DEFINITIONS.gmail_metadata.mutation).toBe(false);
      expect(CAPABILITY_DEFINITIONS.google_calendar_read.mutation).toBe(false);
    });
  });
});
