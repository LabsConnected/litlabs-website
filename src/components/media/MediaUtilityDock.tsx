"use client";

/**
 * MediaUtilityDock — the main entry point for the Media Hub in Studio.
 *
 * Renders either the collapsed bar or the expanded drawer based on
 * the current dock mode. When hidden, renders nothing.
 *
 * This component is meant to be placed inside the Studio bottom
 * utility drawer, alongside Terminal. It does NOT float over content.
 */

import { useMediaHub } from "./MediaHubProvider";
import { MediaCollapsedBar } from "./MediaCollapsedBar";
import { MediaExpandedDrawer } from "./MediaExpandedDrawer";

export function MediaUtilityDock() {
  const { dockMode } = useMediaHub();

  if (dockMode === "hidden") return null;
  if (dockMode === "collapsed") return <MediaCollapsedBar />;
  if (dockMode === "expanded") return <MediaExpandedDrawer />;
  return null;
}
