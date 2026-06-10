#!/bin/bash
# Watch Loop -- Real-time terminal monitor for the Hive Mind
# Run this in any terminal: ./bin/watch-loop.sh

PROJECT_DIR="/home/litbit/LiTTreeLabstudios"

echo "╔══════════════════════════════════════════════════╗"
echo "║     ⚡ LITLABS HIVE MIND -- LIVE MONITOR ⚡      ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to exit"
echo ""

while true; do
  clear
  echo "╔══════════════════════════════════════════════════╗"
  echo "║     ⚡ LITLABS HIVE MIND -- LIVE MONITOR ⚡      ║"
  echo "╠══════════════════════════════════════════════════╣"
  echo "║ $(date '+%Y-%m-%d %H:%M:%S')                              ║"
  echo "╠══════════════════════════════════════════════════╣"
  
  # Active task
  if [ -f "$PROJECT_DIR/tasks/active.json" ]; then
    TASK=$(python3 -c "
import json
with open('$PROJECT_DIR/tasks/active.json') as f:
    d = json.load(f)
print(f\"🎯 {d.get('milestone','?')} [{d.get('status','?')}]\")
print(f\"   {d.get('director_instructions','')[:60]}...\")
" 2>/dev/null)
    echo "║ $TASK"
  else
    echo "║ 🎯 No active task"
  fi
  
  echo "╠══════════════════════════════════════════════════╣"
  
  # Agents
  echo "║ AGENTS:"
  for svc in agent-monitor agent-bridge litlabs-frontend litlabs-api-tunnel; do
    STATUS=$(systemctl is-active "$svc" 2>/dev/null || echo "down")
    ICON="🟢"
    [ "$STATUS" != "active" ] && ICON="🔴"
    echo "║   $ICON $svc: $STATUS"
  done
  
  echo "╠══════════════════════════════════════════════════╣"
  
  # Ollama
  OLLAMA=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:11434/api/tags 2>/dev/null)
  if [ "$OLLAMA" = "200" ]; then
    echo "║ 🧠 Ollama: ONLINE"
  else
    echo "║ 🧠 Ollama: OFFLINE"
  fi
  
  # n8n
  GATEWAY=$(ip route 2>/dev/null | awk '/default/ {print $3}')
  N8N=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://${GATEWAY}:5678" 2>/dev/null)
  if [ "$N8N" = "200" ]; then
    echo "║ 🔄 n8n: ONLINE"
  else
    echo "║ 🔄 n8n: OFFLINE"
  fi
  
  echo "╠══════════════════════════════════════════════════╣"
  
  # Recent commits
  echo "║ RECENT COMMITS:"
  cd "$PROJECT_DIR"
  git log --oneline -3 2>/dev/null | while read line; do
    echo "║   $line"
  done
  
  echo "╠══════════════════════════════════════════════════╣"
  
  # Backlog
  BACKLOG=$(ls "$PROJECT_DIR/tasks/backlog/" 2>/dev/null | wc -l)
  COMPLETED=$(ls "$PROJECT_DIR/tasks/completed/" 2>/dev/null | wc -l)
  echo "║ 📋 Backlog: $BACKLOG | ✅ Completed: $COMPLETED"
  
  echo "╠══════════════════════════════════════════════════╣"
  
  # Last 3 log lines
  echo "║ LAST LOGS:"
  LOG_DIR="$PROJECT_DIR/agents/logs"
  if [ -d "$LOG_DIR" ]; then
    tail -3 "$LOG_DIR"/*.log 2>/dev/null | while read line; do
      echo "║   ${line:0:50}"
    done
  fi
  
  echo "╚══════════════════════════════════════════════════╝"
  
  sleep 5
done
