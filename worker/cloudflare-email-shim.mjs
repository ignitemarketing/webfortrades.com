// Node has no `cloudflare:email`; tests load this (node --import) so the
// Worker module resolves it to a stand-in EmailMessage that records its args.
import { registerHooks } from 'node:module';

const source = `export class EmailMessage {
  constructor(from, to, raw) { this.from = from; this.to = to; this.raw = raw; }
}`;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:email') {
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
    }
    return next(specifier, context);
  },
});
