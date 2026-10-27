// POST /api/waitlist for the waitlist form (src/components/Waitlist.astro).
// Everything else is a static asset from the Astro build output.
//
// Worker secrets (set once, never committed):
//   wrangler secret put POSTMARK_SERVER_TOKEN
//   wrangler secret put NOTIFY_TO      inbox that receives each signup
//   wrangler secret put NOTIFY_FROM    verified Postmark sender
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  POSTMARK_SERVER_TOKEN?: string;
  NOTIFY_TO?: string;
  NOTIFY_FROM?: string;
}

const SITE_ORIGIN = 'https://webfortrades.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_FSM = ['Jobber', 'ServiceTitan', 'Housecall Pro', 'Other', ''];
const MAX_BODY_BYTES = 4096;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const field = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

async function handleWaitlist(request: Request, env: Env): Promise<Response> {
  // Browsers send Origin on POST; refuse cross-site posts. Requests with no
  // Origin (curl, the no-JS form fallback in some browsers) are allowed.
  const origin = request.headers.get('origin');
  if (origin && origin !== SITE_ORIGIN) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'bad_request' }, 413);
  }

  let data: Record<string, unknown>;
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      data = parsed as Record<string, unknown>;
    } else {
      data = Object.fromEntries((await request.formData()).entries());
    }
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  // Honeypot: bots fill this hidden field. Report success, send nothing.
  if (field(data.company, 200) !== '') {
    return json({ ok: true });
  }

  const email = field(data.email, 300).toLowerCase();
  const fsm = field(data.fsm, 50);
  const source = field(data.source, 100) || 'unknown';
  const page = field(data.page, 300);

  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: 'invalid_email' }, 422);
  }
  if (!ALLOWED_FSM.includes(fsm)) {
    return json({ ok: false, error: 'invalid_fsm' }, 422);
  }

  if (!env.POSTMARK_SERVER_TOKEN || !env.NOTIFY_TO || !env.NOTIFY_FROM) {
    console.error('waitlist: POSTMARK_SERVER_TOKEN, NOTIFY_TO or NOTIFY_FROM is not set');
    return json({ ok: false, error: 'server_error' }, 500);
  }

  const textBody = [
    'New waitlist signup',
    '',
    `Source:   ${source}`,
    `Email:    ${email}`,
    `FSM:      ${fsm || '(not provided)'}`,
    `Page:     ${page || '/'}`,
    `Country:  ${request.headers.get('cf-ipcountry') || '(unknown)'}`,
    `Referrer: ${field(request.headers.get('referer'), 300) || '(none)'}`,
    `Agent:    ${field(request.headers.get('user-agent'), 300) || '(unknown)'}`,
  ].join('\n');

  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        From: env.NOTIFY_FROM,
        To: env.NOTIFY_TO,
        ReplyTo: email,
        Subject: `[newco] Waitlist: ${source} — ${email}`,
        TextBody: textBody,
        MessageStream: 'outbound',
      }),
    });
    if (!res.ok) {
      console.error(`waitlist: Postmark returned ${res.status}`);
      return json({ ok: false, error: 'server_error' }, 500);
    }
  } catch (err) {
    console.error('waitlist: Postmark request failed', err);
    return json({ ok: false, error: 'server_error' }, 500);
  }

  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/waitlist') {
      if (request.method !== 'POST') {
        const res = json({ ok: false, error: 'method_not_allowed' }, 405);
        res.headers.set('allow', 'POST');
        return res;
      }
      return handleWaitlist(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
