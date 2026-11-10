#!/usr/bin/env node
/**
 * Pre-publication scan. Fails (exit 1) when a file that Git would publish, or the built client
 * bundle, contains something that looks like a credential, or the value of a key from the local .env.
 *
 *   npm run scan
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tracked = execSync('git ls-files --cached --others --exclude-standard', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const bundle = walk(path.join(root, 'public')).map((p) => path.relative(root, p));

const PATTERNS = [
  ['OpenRouter key', /sk-or-[A-Za-z0-9_-]{16,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/],
  ['Supabase secret', /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ['Stripe key', /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
];
// Values of every non-empty variable in the local .env: none of them may appear in a published file.
const envValues = [];
if (existsSync(path.join(root, '.env'))) {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.+)$/.exec(line.trim());
    if (m && /KEY|TOKEN|SECRET/.test(m[1]) && m[2].trim().length >= 12) envValues.push([m[1], m[2].trim()]);
  }
}

const findings = [];
const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|pdf)$/i;
for (const file of [...new Set([...tracked, ...bundle])]) {
  if (BINARY.test(file) || file === 'package-lock.json') continue;
  let text;
  try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  if (/^\.env(\.|$)/.test(path.basename(file)) && path.basename(file) !== '.env.example') findings.push(`${file}: an environment file would be published`);
  for (const [name, re] of PATTERNS) if (re.test(text)) findings.push(`${file}: looks like a ${name}`);
  for (const [name, value] of envValues) if (text.includes(value)) findings.push(`${file}: contains the value of ${name} from .env`);
}

console.log(`scanned ${tracked.length} publishable files and ${bundle.length} built client files; ${envValues.length} local secret value(s) checked`);
if (findings.length) {
  console.error('FOUND:\n  ' + findings.join('\n  '));
  process.exit(1);
}
console.log('no credentials found');
