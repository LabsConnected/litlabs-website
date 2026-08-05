# Grafana Dashboard Design — Agent Handoff

You're taking over dashboard design. All metrics are wired and emitting.
This document tells you exactly what data is available and what panels to build.

---

## Infrastructure (Already Set Up)

| Component | Status |
|-----------|--------|
| Grafana Cloud stack | `vastantelope1841` — active |
| Prometheus data source | Configured (Alloy pushing metrics) |
| Loki data source | Needs adding (see `grafana/SETUP.md` Step 1) |
| Metrics endpoint | `https://litlabs.net/metrics` — live |
| Alloy agent | Running on Windows host, scraping `localhost:3000/metrics` |
| Existing dashboards | 3 JSON files in `grafana/` (use as reference, redesign freely) |

---

## Available Metrics (18 total — all wired)

### LLM Metrics (4)
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `litlabs_llm_calls_total` | Counter | provider, model, task, status | Every LLM call (success/error) |
| `litlabs_llm_latency_seconds` | Histogram | provider, model, task | Latency buckets: 0.1s → 60s |
| `litlabs_llm_tokens_total` | Counter | provider, model, type | Token usage (prompt/completion) |
| `litlabs_llm_failover_total` | Counter | from_provider | Provider failover events |

### Agent Metrics (2)
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `litlabs_agent_runs_total` | Counter | agent, mode, status | Agent run count (success/error/timeout) |
| `litlabs_agent_run_duration_seconds` | Histogram | agent, mode | Duration buckets: 0.5s → 600s |

### Eval Metrics (2)
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `litlabs_eval_score` | Gauge | dimension, agent | Latest eval score (0-1) |
| `litlabs_eval_runs_total` | Counter | dimension, agent | Total eval runs |

### HTTP/API Metrics (2)
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `litlabs_http_requests_total` | Counter | method, route, status | Every API request |
| `litlabs_http_request_duration_seconds` | Histogram | method, route, status | Duration buckets: 0.01s → 10s |

### API Resilience Metrics (3) — NEW
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `litlabs_api_retries_total` | Counter | status_code, outcome | Retry events (recovered/exhausted) |
| `litlabs_api_errors_total` | Counter | type, status_code | Errors by type (timeout/network/http/html) |
| `litlabs_api_retry_latency_seconds` | Histogram | endpoint | Total time including retries |

### Build/Deploy Metrics (3)
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `litlabs_build_status` | Gauge | branch, commit | 1=success, 0=failed, -1=in_progress |
| `litlabs_build_duration_seconds` | Gauge | branch | Last build duration |
| `litlabs_deploy_status` | Gauge | environment | 1=success, 0=failed, -1=in_progress |

### Visual Build Metrics (2)
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `litlabs_visual_builds_total` | Counter | stage, status | Visual build count by stage |
| `litlabs_visual_build_duration_seconds` | Histogram | stage | Duration buckets: 1s → 1200s |

### Host Metrics (via Alloy / windows_exporter)
| Metric | Type | Description |
|--------|------|-------------|
| `windows_cpu_time_total` | Counter | CPU time per core (idle/active) |
| `windows_memory_physical_free_bytes` | Gauge | Free memory |
| `windows_memory_physical_total_bytes` | Gauge | Total memory |
| `windows_logical_disk_free_bytes` | Gauge | Free disk space per volume |
| `windows_logical_disk_size_bytes` | Gauge | Total disk size per volume |
| Node.js default metrics | Various | GC, event loop, heap, etc. |

---

## Dashboards to Design

### Dashboard 1: System Overview (replace `dashboard-overview.json`)
**Purpose:** At-a-glance health for the whole platform

Panels needed:
1. **CPU Usage %** (timeseries, per core) — `100 - avg by(core) (rate(windows_cpu_time_total{mode="idle"}[5m])) * 100`
2. **Memory Usage %** (gauge) — `(1 - (windows_memory_physical_free_bytes / windows_memory_physical_total_bytes)) * 100`
3. **Disk Free (GB)** (bargauge) — `windows_logical_disk_free_bytes / 1073741824`
4. **LLM Calls/s by Provider** (timeseries) — `sum by(provider) (rate(litlabs_llm_calls_total[5m]))`
5. **LLM p95 Latency by Provider** (timeseries) — `histogram_quantile(0.95, sum by(provider, le) (rate(litlabs_llm_latency_seconds_bucket[5m])))`
6. **LLM Success vs Error Rate** (pie/timeseries) — `sum by(status) (rate(litlabs_llm_calls_total[5m]))`
7. **Token Usage by Type** (timeseries) — `sum by(type) (rate(litlabs_llm_tokens_total[5m]))`
8. **API Requests/s by Status** (timeseries) — `sum by(status) (rate(litlabs_http_requests_total[5m]))`
9. **API p95 Latency by Route** (timeseries) — `histogram_quantile(0.95, sum by(route, le) (rate(litlabs_http_request_duration_seconds_bucket[5m])))`
10. **Active Agent Runs** (stat) — `sum(rate(litlabs_agent_runs_total[5m]))`

### Dashboard 2: API Resilience (NEW — no existing file)
**Purpose:** Monitor the apiFetch retry/error layer

Panels needed:
1. **API Retry Rate** (timeseries) — `sum by(status_code) (rate(litlabs_api_retries_total[5m]))`
2. **Retry Recovery Rate** (stat) — `sum(litlabs_api_retries_total{outcome="recovered"}) / sum(litlabs_api_retries_total) * 100`
3. **Errors by Type** (bargauge) — `sum by(type) (increase(litlabs_api_errors_total[1h]))`
4. **Timeout Errors** (timeseries) — `sum(rate(litlabs_api_errors_total{type="timeout"}[5m]))`
5. **HTML Error Pages Detected** (timeseries) — `sum(rate(litlabs_api_errors_total{type="html"}[5m]))`
6. **Network Errors** (timeseries) — `sum(rate(litlabs_api_errors_total{type="network"}[5m]))`
7. **HTTP 5xx Errors** (timeseries) — `sum(rate(litlabs_api_errors_total{type="http",status_code=~"5.."}[5m]))`
8. **Top Erroring Endpoints** (table) — `topk(10, sum by(endpoint) (increase(litlabs_api_errors_total[1h])))`

### Dashboard 3: Agent & Eval Performance (NEW)
**Purpose:** Track agent behavior and eval quality

Panels needed:
1. **Agent Runs by Status** (timeseries) — `sum by(agent, status) (rate(litlabs_agent_runs_total[5m]))`
2. **Agent Run Duration p95** (timeseries) — `histogram_quantile(0.95, sum by(agent, le) (rate(litlabs_agent_run_duration_seconds_bucket[5m])))`
3. **Eval Scores by Dimension** (timeseries) — `litlabs_eval_score`
4. **Eval Score Heatmap** (heatmap) — `litlabs_eval_score` by dimension and agent
5. **Low Eval Scores** (stat, threshold < 0.5) — `min by(dimension) (litlabs_eval_score)`
6. **Eval Run Count** (bargauge) — `sum by(dimension) (increase(litlabs_eval_runs_total[24h]))`
7. **LLM Failover Events** (timeseries) — `sum by(from_provider) (rate(litlabs_llm_failover_total[5m]))`

### Dashboard 4: Build & Deploy (replace `dashboard-project-health.json`)
**Purpose:** CI/CD pipeline health

Panels needed:
1. **Build Status** (stat, by branch) — `litlabs_build_status` with value mapping (1=Success, 0=Failed, -1=In Progress)
2. **Deploy Status** (stat, by environment) — `litlabs_deploy_status` with value mapping
3. **Build Duration** (timeseries, by branch) — `litlabs_build_duration_seconds`
4. **Visual Build Stages** (timeseries) — `sum by(stage, status) (rate(litlabs_visual_builds_total[5m]))`
5. **Visual Build Duration** (timeseries) — `histogram_quantile(0.95, sum by(stage, le) (rate(litlabs_visual_build_duration_seconds_bucket[5m])))`
6. **LLM Calls (24h by provider)** (bargauge) — `sum by(provider) (increase(litlabs_llm_calls_total[24h]))`
7. **Token Consumption (24h)** (bargauge) — `sum by(provider) (increase(litlabs_llm_tokens_total[24h]))`

### Dashboard 5: Alerts (replace `dashboard-alerts.json`)
**Purpose:** Visual alert panels + create actual Grafana alert rules

Panels needed:
1. **Disk < 10% Free** (stat) — `(windows_logical_disk_free_bytes / windows_logical_disk_size_bytes) * 100 < 10`
2. **Memory > 90%** (stat) — `(1 - (windows_memory_physical_free_bytes / windows_memory_physical_total_bytes)) * 100 > 90`
3. **LLM Error Rate > 10%** (stat) — `(sum(rate(litlabs_llm_calls_total{status="error"}[5m])) / sum(rate(litlabs_llm_calls_total[5m]))) * 100 > 10`
4. **LLM p95 Latency > 30s** (stat) — `histogram_quantile(0.95, sum by(le) (rate(litlabs_llm_latency_seconds_bucket[5m]))) > 30`
5. **Eval Score < 0.5** (stat) — `min(litlabs_eval_score) < 0.5`
6. **API Timeout Spike** (stat) — `increase(litlabs_api_errors_total{type="timeout"}[5m]) > 5`
7. **HTML Error Pages** (stat) — `increase(litlabs_api_errors_total{type="html"}[5m]) > 0`
8. **Alloy Remote Write Failures** (stat) — `increase(prometheus_remote_storage_samples_failed_total[5m]) > 0`

**Alert rules to create** (Grafana → Alerting → New alert rule):
- Each panel above should have a corresponding alert rule
- Notification channel: Discord webhook (recommended) or email
- Evaluation interval: 30s
- For: 2m (persist for 2 minutes before firing)

---

## Dashboard Variables to Add

For all dashboards, add these variables (Settings → Variables):

| Name | Type | Query | Description |
|------|------|-------|-------------|
| `$provider` | Query | `label_values(litlabs_llm_calls_total, provider)` | Filter by LLM provider |
| `$agent` | Query | `label_values(litlabs_agent_runs_total, agent)` | Filter by agent |
| `$route` | Query | `label_values(litlabs_http_requests_total, route)` | Filter by API route |
| `$branch` | Query | `label_values(litlabs_build_status, branch)` | Filter by git branch |
| `$datasource` | Constant | `grafanacloud-vastantelope1841-prom` | Prometheus source |

---

## Design Guidelines

1. **Color scheme:** Use the litlabs dark theme — dark background, accent color `#10b981` (emerald green) for healthy, `#ef4444` (red) for errors, `#f59e0b` (amber) for warnings
2. **Refresh interval:** 30s for overview, 10s for alerts, 1m for build/deploy
3. **Time range defaults:** Overview = last 6h, Alerts = last 1h, Build/Deploy = last 24h
4. **Thresholds:** Green < 70%, Yellow 70-90%, Red > 90% for usage metrics. Inverse for success rates.
5. **Annotations:** Add deploy markers (query: `litlabs_deploy_status` changes)
6. **Mobile:** Ensure panels stack vertically on narrow screens (gridPos w=24 for full width)

---

## Files to Modify

| File | Action |
|------|--------|
| `grafana/dashboard-overview.json` | Redesign with panels from Dashboard 1 |
| `grafana/dashboard-alerts.json` | Redesign with panels from Dashboard 5 |
| `grafana/dashboard-project-health.json` | Redesign with panels from Dashboard 4 |
| `grafana/dashboard-api-resilience.json` | **CREATE** — Dashboard 2 |
| `grafana/dashboard-agent-eval.json` | **CREATE** — Dashboard 3 |
| `scripts/setup-grafana-api.ps1` | Add new dashboards to import list |

---

## How to Test

1. Run `pnpm dev` locally — metrics flow to `localhost:3000/metrics`
2. Alloy scrapes and forwards to Grafana Cloud
3. In Grafana, go to Explore → select Prometheus → query any `litlabs_*` metric
4. If metrics don't appear, check Alloy is running: `Get-Service alloy` (Windows)
5. Production metrics also available at `https://litlabs.net/metrics` (but Vercel instances are ephemeral — local Alloy scrape is more reliable)

---

## What's NOT Wired (Known Gaps)

These metrics are defined but not yet recorded in production:
- `litlabs_build_status` / `litlabs_build_duration_seconds` — needs GitHub Actions workflow to set these
- `litlabs_deploy_status` — needs Vercel webhook or deploy script to set this
- `litlabs_api_retry_latency_seconds` — histogram defined but not observed yet (the `onRetry`/`onError` callbacks are in place but no server-side caller wires them to this metric)

For the design agent: build the dashboards anyway. The metrics will populate once the CI/deploy hooks are added. Empty panels are fine — they'll fill in.
