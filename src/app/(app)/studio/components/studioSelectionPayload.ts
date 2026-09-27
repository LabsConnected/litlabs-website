/**
 * F1 canvas-first Studio — shared contract re-export (SLICE B: chat surfaces).
 *
 * StudioSelectionPayload is canonically defined in
 * src/app/(app)/studio/context/StudioContext.tsx (Agent C owns that file).
 * Slice B imports it from there via this module so consumers have one
 * stable import path regardless of where the canonical type lives.
 */
export type { StudioSelectionPayload } from "../context/StudioContext";
