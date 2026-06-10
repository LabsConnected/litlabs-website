# Deployment & Health Manifest

## Infrastructure Rules
*   **Heartbeat:** monitor-infrastructure.sh runs every 60s.
*   **Port Map:** 3000 (API), 5679 (Chat Agent).
*   **Auto-Restart:** All critical services managed via cron daemon.
*   **State Store:** SQLite (litlabs.db) for jobs, JSON (litlabs.json) for lightweight state.
