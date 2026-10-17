import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/*
 * Sandbox interface. Every tool call goes through exactly these methods:
 *
 *   await sandbox.start()
 *   await sandbox.writeFile(relPath, content)
 *   await sandbox.exec(command, { timeoutMs }) -> { code, stdout, stderr }
 *   await sandbox.publicUrl(port)              -> string
 *   await sandbox.destroy()
 */

// ---------------------------------------------------------------------------
// LocalDevSandbox: for building and testing the agent loop on your laptop.
// NOT ISOLATED. Never use it with prompts you do not trust. Demo on CreateOS.
// ---------------------------------------------------------------------------
export class LocalDevSandbox {
  constructor(env = {}) {
    this.env = env;
    this.dir = null;
  }

  async start() {
    this.dir = await mkdtemp(path.join(tmpdir(), 'shipit-'));
  }

  async writeFile(rel, content) {
    const full = path.join(this.dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  exec(command, { timeoutMs = 120000 } = {}) {
    return new Promise((resolve) => {
      // Do not pass the parent's environment: generated code must not see our API keys.
      const child = spawn('sh', ['-c', command], {
        cwd: this.dir,
        env: { PATH: process.env.PATH, HOME: this.dir, ...this.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: timedOut ? 124 : code, stdout, stderr: timedOut ? stderr + '\n[timed out]' : stderr });
      });
    });
  }

  async publicUrl(port) {
    return `http://localhost:${port}`;
  }

  async destroy() {
    if (this.dir) await rm(this.dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// CreateOSSandbox: PLACEHOLDER ROUTES.
// I could not verify the CreateOS Sandbox API, so the routes and response
// fields below are guesses. Open the CreateOS Sandbox docs and fix the ROUTES
// block and the four "map response" lines. Nothing else needs to change.
// ---------------------------------------------------------------------------
const ROUTES = {
  create: ['POST', '/sandboxes'],
  writeFile: ['PUT', '/sandboxes/:id/files'],
  exec: ['POST', '/sandboxes/:id/exec'],
  publicUrl: ['GET', '/sandboxes/:id/ports/:port'],
  destroy: ['DELETE', '/sandboxes/:id'],
};

export class CreateOSSandbox {
  constructor(env = {}) {
    this.env = env; // injected as sandbox secrets / environment, never written into files
    this.base = process.env.CREATEOS_API_BASE;
    this.key = process.env.CREATEOS_API_KEY;
    this.id = null;
    if (!this.base || !this.key) throw new Error('Set CREATEOS_API_BASE and CREATEOS_API_KEY');
  }

  async #req([method, route], { params = {}, body } = {}) {
    const url = this.base + route.replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k] ?? this[k]));
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`CreateOS ${method} ${route} failed: ${res.status} ${await res.text()}`);
    return res.status === 204 ? {} : res.json();
  }

  async start() {
    const out = await this.#req(ROUTES.create, { body: { env: this.env } });
    this.id = out.id; // map response: sandbox id
  }

  async writeFile(rel, content) {
    await this.#req(ROUTES.writeFile, { body: { path: rel, content } });
  }

  async exec(command, { timeoutMs = 120000 } = {}) {
    const out = await this.#req(ROUTES.exec, { body: { command, timeoutMs } });
    return { code: out.exitCode ?? 0, stdout: out.stdout ?? '', stderr: out.stderr ?? '' }; // map response
  }

  async publicUrl(port) {
    const out = await this.#req(ROUTES.publicUrl, { params: { port } });
    return out.url; // map response: public URL for the port
  }

  async destroy() {
    if (this.id) await this.#req(ROUTES.destroy);
  }
}

export async function createSandbox(env) {
  const sb = process.env.SANDBOX === 'createos' ? new CreateOSSandbox(env) : new LocalDevSandbox(env);
  await sb.start();
  return sb;
}
