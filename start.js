const { spawn } = require('child_process');

const COVEN_URL = 'https://coven.amcknight.ca';

const cf = spawn('cloudflared', ['tunnel', 'run', 'coven'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

cf.stdout.on('data', d => process.stdout.write(d));
cf.stderr.on('data', d => process.stderr.write(d));

cf.on('error', err => {
  if (err.code === 'ENOENT') {
    console.error('cloudflared not found. Install it with: winget install Cloudflare.cloudflared');
  } else {
    console.error('cloudflared error:', err.message);
  }
  process.exit(1);
});

cf.on('exit', code => {
  console.error(`cloudflared exited (code ${code ?? 0})`);
  process.exit(code ?? 1);
});

console.log(`\n  Tunnel: ${COVEN_URL}\n`);

const server = spawn('node', ['server.js'], {
  stdio: 'inherit',
  env: { ...process.env, COVEN_URL },
});
server.on('exit', code => {
  cf.kill();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  cf.kill();
  process.exit(0);
});
