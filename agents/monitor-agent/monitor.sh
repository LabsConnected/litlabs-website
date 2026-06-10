#!/bin/bash
# Monitor Agent -- Continuous monitoring with alerts

LOG_FILE="/home/litbit/LiTTreeLabstudios/agents/logs/monitor-$(date +%Y%m%d).log"
ALERT_FILE="/home/litbit/LiTTreeLabstudios/agents/logs/alerts.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

alert() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $1" | tee -a "$ALERT_FILE" | tee -a "$LOG_FILE"
}

# Check n8n on Windows (via WSL->Windows gateway)
check_n8n() {
  local gateway=$(ip route | awk '/default/ {print $3}')
  local n8n_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://$gateway:5678/healthz" 2>/dev/null)
  
  if [ "$n8n_status" = "200" ]; then
    log "n8n: OK (via $gateway:5678)"
  else
    alert "n8n not responding (status: $n8n_status)"
  fi
}

# Check all endpoints
check_all() {
  log "--- Monitor Check ---"
  
  # Local services
  for svc in litlabs-frontend litlabs-api-tunnel n8n-tunnel; do
    local status=$(systemctl is-active "$svc" 2>/dev/null)
    if [ "$status" != "active" ]; then
      alert "Service $svc is $status"
      systemctl restart "$svc" 2>/dev/null
      log "Attempted restart of $svc"
    else
      log "Service $svc: OK"
    fi
  done
  
  # n8n on Windows
  check_n8n
  
  log "--- Check Complete ---"
}

# Run loop
while true; do
  check_all
  sleep 120  # 2 minutes
done
