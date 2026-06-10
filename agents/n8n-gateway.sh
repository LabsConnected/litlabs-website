#!/bin/bash
# n8n Gateway -- webhook server that n8n can call from Windows
# This runs on the WSL side and n8n hits it from Windows

GATEWAY_PORT=9877
LOG="/home/litbit/LiTTreeLabstudios/agents/logs/n8n-gateway.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"
}

# Start a simple HTTP server that n8n can POST to
# This bridges n8n (Windows) -> System Brain (WSL)

echo "Starting n8n Gateway on port $GATEWAY_PORT..." | tee -a "$LOG"

# Use node if available (via nvm), otherwise python
if command -v node &> /dev/null; then
  cd /home/litbit/LiTTreeLabstudios/agents/bridge
  node webhook-server.js &
  echo "Gateway running (node)"
else
  # Python fallback -- simple HTTP server
  python3 -c "
import http.server, json, subprocess, os

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers['Content-Length'])
        body = json.loads(self.rfile.read(length))
        cmd = body.get('command', '')
        
        log = open('$LOG', 'a')
        log.write(f'Received: {cmd}\n')
        log.close()
        
        if cmd == 'health':
            result = subprocess.run(['bash', '/home/litbit/LiTTreeLabstudios/agents/system-brain/brain.sh'], capture_output=True, text=True)
        elif cmd == 'sync':
            result = subprocess.run(['bash', '/home/litbit/LiTTreeLabstudios/bin/sync.sh'], capture_output=True, text=True)
        elif cmd == 'save':
            msg = body.get('message', 'autonomic save')
            result = subprocess.run(['bash', '/home/litbit/LiTTreeLabstudios/bin/save.sh', msg], capture_output=True, text=True)
        elif cmd == 'build':
            result = subprocess.run(['bash', '/home/litbit/LiTTreeLabstudios/agents/build-agent/build.sh'], capture_output=True, text=True)
        else:
            result = subprocess.run(cmd.split(), capture_output=True, text=True)
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'stdout': result.stdout, 'stderr': result.stderr, 'code': result.returncode}).encode())
    
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'status': 'ok', 'agent': 'n8n-gateway'}).encode())

server = http.server.HTTPServer(('0.0.0.0', $GATEWAY_PORT), Handler)
server.serve_forever()
" &
  echo "Gateway running (python)"
fi

echo "n8n Gateway ready on port $GATEWAY_PORT"
