// Run with: pnpm test  (node --test, Node's built-in TypeScript type stripping)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { type Env } from './index.ts';

const realFetch = globalThis.fetch;
let postmarkCalls: { url: string; body: any }[] = [];
let postmarkStatus = 200;

beforeEach(() => {
  postmarkCalls = [];
  postmarkStatus = 200;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    postmarkCalls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response('{}', { status: postmarkStatus });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const env = (over: Partial<Env> = {}): Env => ({
  ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
  POSTMARK_SERVER_TOKEN: 'test-token',
  NOTIFY_TO: 'to@example.invalid',
  NOTIFY_FROM: 'from@example.invalid',
  ...over,
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://webfortrades.com/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://webfortrades.com', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const valid = { email: 'Owner@Plumbing.example', fsm: 'Jobber', source: 'webfortrades.com', page: '/', company: '' };

test('valid signup returns ok and sends one Postmark email', async () => {
  const res = await worker.fetch(post(valid), env());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(postmarkCalls.length, 1);
  assert.equal(postmarkCalls[0].url, 'https://api.postmarkapp.com/email');
  assert.equal(postmarkCalls[0].body.To, 'to@example.invalid');
  assert.equal(postmarkCalls[0].body.From, 'from@example.invalid');
  assert.equal(postmarkCalls[0].body.ReplyTo, 'owner@plumbing.example');
});

test('form-encoded posts are accepted', async () => {
  const req = new Request('https://webfortrades.com/api/waitlist', {
    method: 'POST',
    body: new URLSearchParams({ email: 'a@b.co', fsm: '' }),
  });
  const res = await worker.fetch(req, env());
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(postmarkCalls.length, 1);
});

test('invalid email returns the error the client expects', async () => {
  const res = await worker.fetch(post({ ...valid, email: 'not-an-email' }), env());
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { ok: false, error: 'invalid_email' });
  assert.equal(postmarkCalls.length, 0);
});

test('unknown fsm is rejected', async () => {
  const res = await worker.fetch(post({ ...valid, fsm: 'Hacked' }), env());
  assert.equal(res.status, 422);
  assert.equal(postmarkCalls.length, 0);
});

test('filled honeypot reports ok and sends nothing', async () => {
  const res = await worker.fetch(post({ ...valid, company: 'Spam LLC' }), env());
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(postmarkCalls.length, 0);
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
  assert.equal(postmarkCalls.length, 1);
});

test('malformed JSON and non-object JSON are bad requests', async () => {
  assert.equal((await worker.fetch(post('{nope'), env())).status, 400);
  assert.equal((await worker.fetch(post('[1,2]'), env())).status, 400);
  assert.equal(postmarkCalls.length, 0);
});

test('missing secrets or a Postmark failure return server_error', async () => {
  const noSecret = await worker.fetch(post(valid), env({ NOTIFY_TO: undefined }));
  assert.equal(noSecret.status, 500);
  assert.equal(postmarkCalls.length, 0);
  postmarkStatus = 422;
  const failed = await worker.fetch(post(valid), env());
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { ok: false, error: 'server_error' });
});

test('source is capped at 100 characters in the subject', async () => {
  await worker.fetch(post({ ...valid, source: 'x'.repeat(500) }), env());
  assert.ok(postmarkCalls[0].body.Subject.includes('x'.repeat(100)));
  assert.ok(!postmarkCalls[0].body.Subject.includes('x'.repeat(101)));
});

test('GET /api/waitlist is 405; other paths go to static assets', async () => {
  const get = await worker.fetch(new Request('https://webfortrades.com/api/waitlist'), env());
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  const page = await worker.fetch(new Request('https://webfortrades.com/'), env());
  assert.equal(await page.text(), 'asset');
});
