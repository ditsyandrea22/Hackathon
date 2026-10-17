import { check, safePath } from './policy.js';

export const toolDefs = [
  {
    name: 'write_file',
    description: 'Create or overwrite a file in the sandbox project folder. Path must be relative.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description:
      'Run a shell command in the sandbox project folder. Set background=true for servers; the call returns after 2 seconds with the first log lines.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        background: { type: 'boolean' },
        timeout_seconds: { type: 'integer', description: 'Foreground only. Default 120, max 300.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_logs',
    description: 'Read the last 60 lines of the background process log.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_public_url',
    description: 'Get the public URL for a port the app is listening on.',
    input_schema: { type: 'object', properties: { port: { type: 'integer' } }, required: ['port'] },
  },
  {
    name: 'finish',
    description: 'Call once the app works and you have the public URL.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' }, summary: { type: 'string' } },
      required: ['url', 'summary'],
    },
  },
];

const ok = (text, data) => ({ text, data });
const fail = (text) => ({ text, is_error: true });
const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const tail = (s, n = 4000) => (s.length > n ? '...' + s.slice(-n) : s);
const fmt = (r) => `exit ${r.code}\n${tail(r.stdout)}${r.stderr ? `\n[stderr]\n${tail(r.stderr)}` : ''}`;

export async function runTool(call, { sandbox, emit, ask }) {
  const { name, input } = call;
  try {
    switch (name) {
      case 'write_file': {
        const p = safePath(input.path);
        await sandbox.writeFile(p, String(input.content ?? ''));
        return ok(`wrote ${p} (${String(input.content ?? '').length} chars)`);
      }

      case 'run_command': {
        const command = String(input.command ?? '');
        const { verdict, reason } = check(command);

        if (verdict === 'deny') {
          emit('blocked', { command, reason });
          return fail(`Blocked by policy: ${reason}. Do not retry this command.`);
        }
        if (verdict === 'ask') {
          emit('blocked', { command, reason: `needs approval: ${reason}` });
          const approved = await ask({ command, reason });
          emit('decision', { command, approved });
          if (!approved) return fail('The user denied this command. Choose another way.');
        }

        if (input.background) {
          const wrapped = `nohup sh -c ${q(command)} > .bg.log 2>&1 & sleep 2; tail -n 30 .bg.log`;
          return ok(fmt(await sandbox.exec(wrapped, { timeoutMs: 15000 })));
        }
        const secs = Math.min(Math.max(input.timeout_seconds || 120, 1), 300);
        return ok(fmt(await sandbox.exec(command, { timeoutMs: secs * 1000 })));
      }

      case 'read_logs':
        return ok(fmt(await sandbox.exec('tail -n 60 .bg.log', { timeoutMs: 10000 })));

      case 'get_public_url':
        return ok(await sandbox.publicUrl(input.port));

      case 'finish':
        if (!/^https?:\/\//.test(input.url || '')) return fail('finish needs a real URL from get_public_url');
        return ok('done', { url: input.url, summary: input.summary });

      default:
        return fail(`unknown tool: ${name}`);
    }
  } catch (err) {
    return fail(String(err.message || err));
  }
}
