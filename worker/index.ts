// POST /api/waitlist for the waitlist form (src/components/Waitlist.astro).
// Everything else is a static asset from the Astro build output.
//
// Each signup is emailed through the NOTIFY send_email binding in
// wrangler.jsonc (Cloudflare Email Routing), which only delivers to its
// destination_address. No secrets: the sender is NOTIFY_FROM below.
// https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/
import { EmailMessage } from 'cloudflare:email';

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  NOTIFY: { send(message: EmailMessage): Promise<unknown> };
}

const SITE_ORIGIN = 'https://webfortrades.com';
const NOTIFY_FROM = 'waitlist@webfortrades.com';
// Must match send_email[].destination_address in wrangler.jsonc.
const NOTIFY_TO = 'colin+fieldservice@colingreig.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_FSM = ['Jobber', 'ServiceTitan', 'Housecall Pro', 'Other', ''];
const MAX_BODY_BYTES = 4096;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// Control characters (CR/LF included) become spaces so user input can never
// add a header line to the MIME message.
const field = (v: unknown, max: number) =>
  String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);

const base64 = (s: string) => {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
};

// RFC 2047 encoded-word for any header value that is not plain ASCII.
const headerValue = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${base64(s)}?=`);

export function buildMime(subject: string, replyTo: string, text: string): string {
  return [
    `From: webfortrades waitlist <${NOTIFY_FROM}>`,
    `To: ${NOTIFY_TO}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${headerValue(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@webfortrades.com>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(text).replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
}

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
    const raw = buildMime(`[newco] Waitlist: ${source} — ${email}`, email, textBody);
    await env.NOTIFY.send(new EmailMessage(NOTIFY_FROM, NOTIFY_TO, raw));
  } catch (err) {
    console.error('waitlist: send_email failed', err);
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
