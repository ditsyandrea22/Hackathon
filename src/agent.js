import OpenAI from 'openai';
import { toolDefs, runTool } from './tools.js';
import { SYSTEM_PROMPT } from './prompt.js';

export const MAX_STEPS = 25;

// AgentRouter sometimes answers with `content-type: text/plain`, so the SDK
// returns the raw JSON string instead of a parsed response.
function parseResponse(res) {
  if (typeof res === 'string') return JSON.parse(res);
  if (res && typeof res === 'object' && !Array.isArray(res) && !('choices' in res)) {
    const text = String(res);
    if (text.trimStart().startsWith('{')) return JSON.parse(text);
  }
  return res;
}

const tools = toolDefs.map((t) => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    // Some providers validate strictly and reject a null `required`.
    parameters: {
      type: 'object',
      properties: t.input_schema.properties || {},
      required: t.input_schema.required || [],
    },
  },
}));

export async function runAgent({ prompt, sandbox, emit, ask, aborted = () => false }) {
  // AgentRouter only accepts allowlisted client User-Agents; the SDK default is rejected.
  const client = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL || 'https://agentrouter.org/v1',
    apiKey: process.env.OPENAI_API_KEY,
    defaultHeaders: { 'User-Agent': process.env.AGENT_USER_AGENT || 'claude-cli/2.0.0 (external, cli)' },
  });
  const model = process.env.MODEL || 'deepseek-v4-flash';
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (aborted()) return null;
    emit('step', { step, max: MAX_STEPS });

    const res = parseResponse(await client.chat.completions.create({ model, max_tokens: 4096, tools, messages }));
    const msg = res?.choices?.[0]?.message;
    if (!msg) throw new Error(`Unexpected model response: ${JSON.stringify(res).slice(0, 300)}`);

    const calls = msg.tool_calls || [];
    messages.push({ role: 'assistant', content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });

    if (msg.content?.trim()) emit('say', { text: msg.content.trim() });
    if (calls.length === 0) return null;

    let finished = null;
    for (const call of calls) {
      const name = call.function.name;
      let input = {};
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        input = {};
      }
      emit('tool', { name, input });
      const out = await runTool({ name, input }, { sandbox, emit, ask });
      emit('result', { name, text: out.text.slice(0, 2000), isError: !!out.is_error });
      if (name === 'finish' && !out.is_error) finished = out.data;
      messages.push({ role: 'tool', tool_call_id: call.id, content: out.text });
    }
    if (finished) return finished;
  }
  return null;
}
