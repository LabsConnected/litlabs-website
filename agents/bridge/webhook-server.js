const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 9876;
const LOG_FILE = '/home/litbit/LiTTreeLabstudios/agents/logs/bridge.log';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', agent: 'system-brain-bridge' }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      log(`Received: ${JSON.stringify(data)}`);

      // Handle different agent commands
      switch (data.command) {
        case 'health-check':
          exec('bash /home/litbit/LiTTreeLabstudios/agents/system-brain/brain.sh', (err, stdout) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result: stdout, error: err?.message || null }));
          });
          break;

        case 'deploy':
          exec('bash /home/litbit/LiTTreeLabstudios/agents/deploy-agent/deploy.sh', (err, stdout) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result: stdout, error: err?.message || null }));
          });
          break;

        case 'build':
          exec('bash /home/litbit/LiTTreeLabstudios/agents/build-agent/build.sh', (err, stdout) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result: stdout, error: err?.message || null }));
          });
          break;

        case 'sync':
          exec('rsync -a --delete --exclude=node_modules --exclude=.next --exclude=.git --exclude=.env.local /home/litbit/LiTTreeLabstudios/ /mnt/c/Users/litbi/CascadeProjects/litlabs-website/', (err, stdout) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result: 'synced', error: err?.message || null }));
          });
          break;

        case 'restart-service':
          const service = data.service || 'litlabs-frontend';
          exec(`systemctl restart ${service}`, (err, stdout) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ service, error: err?.message || null }));
          });
          break;

        default:
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown command: ${data.command}` }));
      }
    } catch (e) {
      log(`Error: ${e.message}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  log(`System Brain Bridge running on port ${PORT}`);
});
