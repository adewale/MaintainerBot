import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [fingerprint, reason = 'Rejected by maintainer', repo = ''] = process.argv.slice(2);
if (!fingerprint) {
  console.error('Usage: pnpm run reject -- <fingerprint> [reason] [repo]');
  process.exit(1);
}

const path = 'data/rejections.json';
const data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { version: 1, rejected: [] };
if (!Array.isArray(data.rejected)) data.rejected = [];
if (!data.rejected.some((item) => item.fingerprint === fingerprint)) {
  data.rejected.push({ repo, fingerprint, reason, rejectedAt: new Date().toISOString() });
}
writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Recorded rejection: ${fingerprint}`);
console.log('For Cloudflare/R2, upload this file with:');
console.log('pnpm exec wrangler r2 object put maintainerbot-data/data/rejections.json --file data/rejections.json --remote');
