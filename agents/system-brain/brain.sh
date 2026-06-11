#!/bin/bash
# System Brain -- Main Orchestrator Agent
# Monitors all services, coordinates other agents, reports status

LOG_DIR="/home/litbit/LiTTreeLabstudios/agents/logs"
LOG_FILE="$LOG_DIR/brain-$(date +%Y%m%d).log"
STATE_FILE="/home/litbit/LiTTreeLabstudios/agents/state.json"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== System Brain Starting ==="

# Check all services
check_services() {
  local frontend=$(systemctl is-active litlabs-frontend 2>/dev/null)
  local cloudflared=$(systemctl is-active cloudflared-main 2>/dev/null)
  local n8n_svc=$(systemctl is-active n8n 2>/dev/null)

  log "Services: frontend=$frontend cloudflared=$cloudflared n8n=$n8n_svc"

  # Restart any down services
  if [ "$frontend" != "active" ]; then
    log "WARNING: frontend down, restarting..."
    systemctl restart litlabs-frontend
  fi
  if [ "$cloudflared" != "active" ]; then
    log "WARNING: cloudflared down, restarting..."
    systemctl restart cloudflared-main
  fi
  if [ "$n8n_svc" != "active" ]; then
    log "WARNING: n8n down, restarting..."
    systemctl restart n8n
  fi
}

# Check websites
check_websites() {
  local litlabs=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://litlabs.net 2>/dev/null)
  local api=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://api.litlabs.net 2>/dev/null)
  
  log "Websites: litlabs.net=$litlabs api.litlabs.net=$api"
  
  if [ "$litlabs" != "200" ]; then
    log "ALERT: litlabs.net returned $litlabs"
  fi
  if [ "$api" != "200" ]; then
    log "ALERT: api.litlabs.net returned $api"
  fi
}

# Check disk space
check_disk() {
  local usage=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
  log "Disk usage: ${usage}%"
  if [ "$usage" -gt 85 ]; then
    log "WARNING: Disk usage above 85%"
  fi
}

# Check memory
check_memory() {
  local mem=$(free -m | awk 'NR==2 {printf "%.0f", $3/$2*100}')
  log "Memory usage: ${mem}%"
  if [ "$mem" -gt 90 ]; then
    log "WARNING: Memory usage above 90%"
  fi
}

# Git status check
check_git() {
  cd /home/litbit/LiTTreeLabstudios
  local changes=$(git status --porcelain 2>/dev/null | wc -l)
  if [ "$changes" -gt 0 ]; then
    log "Git: $changes uncommitted changes detected"
  fi
}

# Main check cycle
main() {
  log "--- Health Check Cycle ---"
  check_services
  check_websites
  check_disk
  check_memory
  check_git
  log "--- Cycle Complete ---"
}

# Run once if called directly, or loop if RUN_LOOP is set
if [ "$RUN_LOOP" = "1" ]; then
  while true; do
    main
    sleep 300  # 5 minutes
  done
else
  main
fi
