// Run with: pnpm test  (node --test, Node's built-in TypeScript type stripping;
// worker/cloudflare-email-shim.mjs stands in for `cloudflare:email`)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { type Env } from './index.ts';

type Sent = { from: string; to: string; raw: string };
let sent: Sent[] = [];
let sendError: Error | null = null;

beforeEach(() => {
  sent = [];
  sendError = null;
});

const env = (): Env => ({
  ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
  NOTIFY: {
    send: async (message: any) => {
      if (sendError) throw sendError;
      sent.push(message);
    },
  },
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://webfortrades.com/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://webfortrades.com', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const valid = { email: 'Owner@Plumbing.example', fsm: 'Jobber', source: 'webfortrades.com', page: '/', company: '' };

const headers = (raw: string) => raw.split('\r\n\r\n')[0].split('\r\n');
const header = (raw: string, name: string) =>
  headers(raw).find((h) => h.toLowerCase().startsWith(name.toLowerCase() + ':'))?.slice(name.length + 1).trim();
const subject = (raw: string) => {
  const v = header(raw, 'Subject')!;
  const m = v.match(/^=\?UTF-8\?B\?(.*)\?=$/);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : v;
};
const bodyText = (raw: string) => Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');

test('valid signup returns ok and sends one email through the binding', async () => {
  const res = await worker.fetch(post(valid), env());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, 'waitlist@webfortrades.com');
  assert.equal(sent[0].to, 'colin+fieldservice@colingreig.com');
  const raw = sent[0].raw;
  assert.equal(header(raw, 'To'), 'colin+fieldservice@colingreig.com');
  assert.equal(header(raw, 'From'), 'webfortrades waitlist <waitlist@webfortrades.com>');
  assert.equal(header(raw, 'Reply-To'), 'owner@plumbing.example');
  assert.match(header(raw, 'Message-ID')!, /^<[0-9a-f-]{36}@webfortrades\.com>$/);
  assert.equal(subject(raw), '[newco] Waitlist: webfortrades.com — owner@plumbing.example');
  assert.match(bodyText(raw), /Email:    owner@plumbing\.example\nFSM:      Jobber/);
});

test('wrangler.jsonc binding destination matches the Worker recipient', async () => {
  const { readFile } = await import('node:fs/promises');
  const cfg = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(cfg, /"name": "NOTIFY", "destination_address": "colin\+fieldservice@colingreig\.com"/);
});

test('form-encoded posts are accepted', async () => {
  const req = new Request('https://webfortrades.com/api/waitlist', {
    method: 'POST',
    body: new URLSearchParams({ email: 'a@b.co', fsm: '' }),
  });
  const res = await worker.fetch(req, env());
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 1);
});

test('invalid email returns the error the client expects', async () => {
  const res = await worker.fetch(post({ ...valid, email: 'not-an-email' }), env());
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { ok: false, error: 'invalid_email' });
  assert.equal(sent.length, 0);
});

test('unknown fsm is rejected', async () => {
  const res = await worker.fetch(post({ ...valid, fsm: 'Hacked' }), env());
  assert.equal(res.status, 422);
  assert.equal(sent.length, 0);
});

test('filled honeypot reports ok and sends nothing', async () => {
  const res = await worker.fetch(post({ ...valid, company: 'Spam LLC' }), env());
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 0);
});

test('cross-site Origin is refused; missing Origin is allowed', async () => {
  const bad = await worker.fetch(post(valid, { origin: 'https://evil.example' }), env());
  assert.equal(bad.status, 403);
  const req = new Request('https://webfortrades.com/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(valid),
  });
  const ok = await worker.fetch(req, env());
  assert.equal(ok.status, 200);
  assert.equal(sent.length, 1);
});

test('oversized and malformed bodies are bad requests', async () => {
  assert.equal((await worker.fetch(post(valid, { 'content-length': '5000' }), env())).status, 413);
  assert.equal((await worker.fetch(post('{nope'), env())).status, 400);
  assert.equal((await worker.fetch(post('[1,2]'), env())).status, 400);
  assert.equal(sent.length, 0);
});

test('a send_email failure returns server_error', async () => {
  sendError = new Error('E_RECIPIENT_NOT_ALLOWED');
  const failed = await worker.fetch(post(valid), env());
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { ok: false, error: 'server_error' });
});

test('source is capped at 100 characters and cannot inject headers', async () => {
  await worker.fetch(post({ ...valid, source: 'x'.repeat(500) }), env());
  assert.ok(subject(sent[0].raw).includes('x'.repeat(100)));
  assert.ok(!subject(sent[0].raw).includes('x'.repeat(101)));
  await worker.fetch(post({ ...valid, source: 'evil\r\nBcc: victim@example.com' }), env());
  assert.ok(!headers(sent[1].raw).some((h) => h.toLowerCase().startsWith('bcc:')));
  assert.equal(subject(sent[1].raw), '[newco] Waitlist: evil  Bcc: victim@example.com — owner@plumbing.example');
});

test('GET /api/waitlist is 405; other paths go to static assets', async () => {
  const get = await worker.fetch(new Request('https://webfortrades.com/api/waitlist'), env());
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  const page = await worker.fetch(new Request('https://webfortrades.com/'), env());
  assert.equal(await page.text(), 'asset');
});
