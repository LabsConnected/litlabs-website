#!/bin/bash
ERROR_LOG=$1
TASK_FILE="/home/litbit/LiTTreeLabstudios/tasks/active.json"

if [ -z "$ERROR_LOG" ]; then
  echo "❌ Error: No log provided."
  exit 1
fi

echo "🩹 Injecting error logs into tasks/active.json..."
python3 -c "
import json, sys
log = sys.argv[1]
with open('$TASK_FILE', 'r') as f:
    data = json.load(f)
data['error_logs'] = log
data['status'] = 'fixing'
with open('$TASK_FILE', 'w') as f:
    json.dump(data, f, indent=2)
" "$ERROR_LOG"

echo "✅ Error logs injected. AI Executor will see these on the next loop."
