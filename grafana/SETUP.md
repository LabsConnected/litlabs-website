# Grafana Assistant Setup — Full Stack Observability

This guide walks you through enabling Grafana Assistant and connecting it
to your full project stack: metrics (Prometheus), logs (Loki), GitHub
(code/PRs/issues), and Vercel (deployments).

## Prerequisites

- Grafana Cloud stack: `vastantelope1841`
- Prometheus data source: configured (Alloy pushing metrics)
- Loki data source: configure after running `fix-alloy-config.ps1 -LokiUrl <url>`
- Admin access to the Grafana Cloud stack

---

## Step 1: Add Loki (Logs)

### 1a. Find your Loki URL

1. Go to https://grafana.com → your stack (`vastantelope1841`)
2. Left sidebar → **Loki**
3. Copy the **URL** (looks like `https://logs-prod-XXX-us-east-2.grafana.net`)
4. Append `/loki/api/v1/push` to it

### 1b. Update Alloy to forward logs

Run as Administrator:
```powershell
cd "E:\LiTTreeLabStudio Prod"
.\scripts\fix-alloy-config.ps1 -LokiUrl "https://logs-prod-XXX-us-east-2.grafana.net/loki/api/v1/push"
```

This adds Windows Event Log forwarding (Application + System) to Loki.

### 1c. Add Loki as a data source in Grafana

1. Go to your Grafana instance → **Connections → Data sources → Add data source**
2. Select **Loki**
3. URL: `https://logs-prod-XXX-us-east-2.grafana.net` (without the `/loki/api/v1/push` suffix)
4. Basic Auth: checked
5. User: `3425326`
6. Password: your Grafana Cloud API key
7. Click **Save & Test**

---

## Step 2: Enable Grafana Assistant

### For Grafana Cloud Free/Pro stacks:

1. Go to your Grafana instance (https://vastantelope1841.grafana.net)
2. Left sidebar → **Assistant** (or visit `/a/grafana-assistant-app/`)
3. On first use, terms are accepted automatically on Free/Pro stacks
4. If prompted for admin enablement:
   - Go to **Administration → Plugins and data → Plugins**
   - Search **"Grafana Assistant"**
   - Click **Enable Assistant**
   - Accept terms if prompted
   - Check **Enable Assistant**
   - **Save**

### Verify data sources are visible to Assistant

Assistant auto-discovers configured data sources. After adding Loki,
Assistant will be able to query both Prometheus (metrics) and Loki (logs).

---

## Step 3: Connect GitHub MCP

This lets Assistant read your code, PRs, issues, and commits.

### 3a. Create a GitHub Personal Access Token

1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)** or **Fine-grained token**
3. Scopes needed:
   - `repo` (read code, PRs, issues)
   - `read:org` (if your repo is in an org)
4. Copy the token (starts with `ghp_` or `github_pat_`)

### 3b. Add GitHub MCP server in Grafana Assistant

1. In Grafana → **Assistant → Settings → MCP servers**
2. Click **Add MCP server**
3. Name: `GitHub`
4. Type: **GitHub** (or custom if not listed)
5. Paste your GitHub token
6. Repository: `LabsConnected/litlabs-website`
7. Save

Now Assistant can answer questions like:
- "What's the latest commit on fix/studio-essentials?"
- "Show me open PRs for this repo"
- "What files changed in the last commit?"
- "Are there any failing CI checks?"

---

## Step 4: Connect Vercel MCP

This lets Assistant check deployment status, preview URLs, and logs.

### 4a. Create a Vercel API token

1. Go to https://vercel.com → your account → **Settings → Tokens**
2. Click **Create Token**
3. Name: `Grafana Assistant`
4. Scope: Full access (or limit to your project)
5. Copy the token

### 4b. Add Vercel MCP server in Grafana Assistant

1. In Grafana → **Assistant → Settings → MCP servers**
2. Click **Add MCP server**
3. Name: `Vercel`
4. Type: **Vercel** (or custom if not listed)
5. Paste your Vercel token
6. Project: your litlabs-website project
7. Save

Now Assistant can answer questions like:
- "What's the latest deployment status?"
- "Show me the preview URL for the last commit"
- "Are there any build errors on Vercel?"
- "When was the last production deploy?"

---

## Step 5: Import Dashboards

Import the three dashboard JSON files from `grafana/`:

1. Go to **Dashboards → Import**
2. Click **Upload JSON file**
3. Select:
   - `grafana/dashboard-overview.json` — Host + app metrics overview
   - `grafana/dashboard-alerts.json` — Alert panels (disk, memory, LLM errors, etc.)
   - `grafana/dashboard-project-health.json` — Build/deploy status, eval trends, agent activity
4. Select your Prometheus data source for each
5. Click **Import**

---

## Step 6: Verify Assistant can see everything

In Grafana Assistant, try asking:

**Metrics:**
- "What's the current CPU usage on LiTreeCEO?"
- "Show me LLM call latency over the last hour"
- "How many tokens has the app consumed today?"

**Logs (after Loki is set up):**
- "Show me recent Windows Application event log errors"
- "Any Alloy service errors in the last 10 minutes?"

**GitHub:**
- "What's the latest commit on fix/studio-essentials?"
- "Show me open issues for LabsConnected/litlabs-website"

**Vercel:**
- "What's the latest deployment status?"
- "Show me build logs for the last deploy"

**Cross-stack:**
- "Did the last deploy correlate with any LLM error spikes?"
- "Show me app metrics around the time of the last GitHub commit"
