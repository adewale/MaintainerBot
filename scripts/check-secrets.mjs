import { readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set(['node_modules', '.git', 'dist']);
const ignoredFiles = new Set(['pnpm-lock.yaml']);

const patterns = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'OpenAI API key', re: /sk-[A-Za-z0-9]{32,}/g },
  { name: 'GitHub token', re: /github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}/g },
  { name: 'Cloudflare API token-like value', re: /[A-Za-z0-9_-]{40,}/g },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/g },
  { name: 'Env assignment with secret-ish name', re: /(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)\s*=\s*['\"]?[^\s'\"]{8,}/gi },
];

const allowedExamples = [
  'your-key',
  'your-anthropic-key',
  'github_pat_or_classic_token',
  'your-resend-key',
  'ANTHROPIC_API_KEY=...',
  'GITHUB_TOKEN=...',
];

async function walk(dir, files = []) {
  for (const entry of await readdir(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const path = join(dir, entry);
    const s = await stat(path);
    if (s.isDirectory()) await walk(path, files);
    else if (!ignoredFiles.has(entry)) files.push(path);
  }
  return files;
}

function isText(buffer) {
  return !buffer.includes(0);
}

const findings = [];
for (const file of await walk(root)) {
  const rel = relative(root, file);
  const buffer = readFileSync(file);
  if (!isText(buffer)) continue;
  const text = buffer.toString('utf8');
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.re)) {
      const value = match[0];
      if (allowedExamples.some((example) => value.includes(example))) continue;
      if (rel === '.env.example') continue;
      if (pattern.name === 'Cloudflare API token-like value' && !/(TOKEN|SECRET|API_KEY|Authorization|Bearer)/i.test(text.slice(Math.max(0, match.index - 80), match.index + 80))) continue;
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({ file: rel, line, type: pattern.name, value: value.slice(0, 12) + '…' });
    }
  }
}

if (findings.length) {
  console.error('Potential secrets found:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.type} (${finding.value})`);
  }
  console.error('\nRemove the secret, rotate it if it was real, and commit only examples/placeholders.');
  process.exit(1);
}

console.log('No obvious secrets found.');
