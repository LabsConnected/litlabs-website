/**
 * Database row types for LiTT connector tables.
 * These types mirror the Supabase tables created in the
 * 20260802010000_litt_connectors_provider_registry migration.
 */

export interface PlatformIntegrationRow {
  id: string;
  provider: string;
  configured: boolean;
  healthy: boolean;
  last_verified_at: string | null;
  endpoint_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UserConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string | null;
  provider_account_name: string | null;
  provider_account_email: string | null;
  scopes: string[];
  requested_scopes: string[];
  status: "connected" | "degraded" | "expired" | "missing_permission" | "disconnected";
  connection_reference: string | null;
  last_connected_at: string | null;
  last_verified_at: string | null;
  last_access_at: string | null;
  revoked: boolean;
  revoked_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UserConnectionCredentialRow {
  id: string;
  user_connection_id: string;
  credential_type: string;
  encrypted_value: string;
  expires_at: string | null;
  scopes: string[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ConnectorCapabilityRow {
  id: string;
  user_id: string;
  capability_id: string;
  provider: string;
  status: "ready" | "unavailable" | "unknown" | "needs_connection" | "needs_permission" | "disabled";
  user_connection_id: string | null;
  last_verified_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ConnectorAuditLogRow {
  id: string;
  user_id: string;
  capability_id: string;
  provider: string;
  action: string;
  status: "success" | "failed" | "denied" | "pending_approval" | "approved" | "revoked";
  input_summary: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  user_connection_id: string | null;
  approved_by: string | null;
  created_at: string;
}

export interface UserPreferencesRow {
  id: string;
  user_id: string;
  timezone: string | null;
  locale: string | null;
  temperature_unit: "celsius" | "fahrenheit";
  distance_unit: "metric" | "imperial";
  location_mode: "none" | "manual_city" | "device_location";
  saved_city: string | null;
  saved_region: string | null;
  country_code: string | null;
  news_interests: string[];
  daily_briefing_enabled: boolean;
  daily_briefing_time: string | null;
  default_calendar_provider: string | null;
  default_email_provider: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
