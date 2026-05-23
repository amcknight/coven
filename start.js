const { spawn } = require('child_process');

const cf = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:8080'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let started = false;
let buf = '';

function tryExtractUrl(text) {
  if (started) return;
  buf += text;
  const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m) return;
  started = true;
  const url = m[0];
  console.log(`\n  Tunnel: ${url}\n`);
  const server = spawn('node', ['server.js'], {
    stdio: 'inherit',
    env: { ...process.env, COVEN_URL: url },
  });
  server.on('exit', code => process.exit(code ?? 0));
}

cf.stdout.on('data', d => tryExtractUrl(d.toString()));
cf.stderr.on('data', d => tryExtractUrl(d.toString()));

cf.on('exit', code => {
  if (!started) {
    console.error('cloudflared exited before providing a URL');
    process.exit(code ?? 1);
  }
});

process.on('SIGINT', () => {
  cf.kill();
  process.exit(0);
});
