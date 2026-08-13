#!/usr/bin/env node

// LiTT Code CLI — official terminal interface for LiTTree Lab Studios.
//
// This package's `litt` binary delegates to the canonical LiTT Runtime
// at POST /api/litt/run with agentMode: "cli". It does NOT implement a
// second AI architecture — the server resolves auth, project, capabilities,
// and provider state itself.

import "./cli/litt-cli.js";