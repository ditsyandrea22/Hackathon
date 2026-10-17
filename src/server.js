import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSandbox } from './sandbox.js';
import { runAgent, MAX_STEPS } from './agent.js';

const app = express();
app.use(express.json());
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

const TEST_KEY = /^(rk|sk)_test_/;
const SANDBOX_TTL_MS = 30 * 60 * 1000;
const pending = new Map(); // approval id -> resolve(boolean)

app.get('/api/config', (_req, res) => {
  res.json({
    sandbox: process.env.SANDBOX === 'createos' ? 'CreateOS microVM' : 'Local dev (not isolated)',
    maxSteps: MAX_STEPS,
    stripeReady: TEST_KEY.test(process.env.STRIPE_TEST_KEY || ''),
  });
});

app.post('/api/approve', (req, res) => {
  const resolve = pending.get(req.body?.id);
  if (!resolve) return res.status(404).json({ error: 'unknown or expired approval' });
  resolve(!!req.body.approved);
  res.json({ ok: true });
});

app.get('/api/run', async (req, res) => {
  const prompt = String(req.query.prompt || '').trim().slice(0, 600);
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();

  let closed = false;
  res.on('close', () => (closed = true));
  const emit = (type, data = {}) => {
    if (!closed) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const key = process.env.STRIPE_TEST_KEY || '';
  if (!TEST_KEY.test(key)) {
    emit('failure', { message: 'STRIPE_TEST_KEY must be a Stripe test key (rk_test_ or sk_test_).' });
    return res.end();
  }

  // Waits up to 60 seconds for the person to allow or deny; silence means deny.
  const ask = (info) =>
    new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(false);
      }, 60000);
      pending.set(id, (approved) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(approved);
      });
      emit('approval', { id, ...info });
    });

  let sandbox;
  try {
    sandbox = await createSandbox({ STRIPE_SECRET_KEY: key });
    emit('sandbox', { ready: true });
    const result = await runAgent({ prompt, sandbox, emit, ask, aborted: () => closed });
    if (result) emit('done', result);
    else emit('failure', { message: 'The agent stopped before it had a working app. Try a simpler request.' });
  } catch (err) {
    emit('failure', { message: String(err.message || err) });
  } finally {
    res.end();
    // Keep the app alive for the demo, then clean up.
    if (sandbox) setTimeout(() => sandbox.destroy().catch(() => {}), SANDBOX_TTL_MS).unref();
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Ship It running on http://localhost:${port}`));
