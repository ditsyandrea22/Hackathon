// Command policy. This is a speed bump and a UX feature, not the security boundary.
// The real boundary is the CreateOS microVM plus its egress allowlist.

const DENY = [
  [/\brm\s+(-\w+\s+)*\/(\s|\*|$)/, 'deleting the filesystem root'],
  [/:\(\)\s*\{/, 'fork bomb'],
  [/\bmkfs(\.\w+)?\b/, 'formatting a disk'],
  [/\bdd\s+if=/, 'raw disk access'],
  [/\bprintenv\b/, 'reading environment secrets'],
  [/\benv\s*($|\||>)/, 'reading environment secrets'],
  [/\$\{?(STRIPE|ANTHROPIC|OPENAI|CREATEOS)\w*/, 'reading secret values'],
  [/\/etc\/(shadow|passwd)/, 'reading system credential files'],
];

const ASK = [
  [/\bsudo\b/, 'wants elevated privileges'],
  [/\bchmod\s+-R\b/, 'wants to change permissions recursively'],
  [/\b(ssh|scp|nc|ncat)\b/, 'wants to open a remote connection'],
  [/\b(npm|pnpm|yarn)\s+(i|install|add)\b.*(git\+|https?:|github:)/, 'wants to install a package from a URL'],
  [/\bpip3?\s+install\b.*(git\+|https?:)/, 'wants to install a package from a URL'],
];

const FETCHERS = /\b(curl|wget)\b/;
const LOCAL = /(localhost|127\.0\.0\.1|0\.0\.0\.0)/;

export function check(command) {
  for (const [re, reason] of DENY) if (re.test(command)) return { verdict: 'deny', reason };
  for (const [re, reason] of ASK) if (re.test(command)) return { verdict: 'ask', reason };
  if (FETCHERS.test(command) && !LOCAL.test(command)) {
    return { verdict: 'ask', reason: 'wants to fetch from an outside host' };
  }
  return { verdict: 'allow', reason: '' };
}

// Files are written relative to the sandbox working directory only.
export function safePath(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('path is required');
  const norm = p.replace(/\\/g, '/').replace(/^\.\//, '');
  if (norm.startsWith('/') || norm.split('/').includes('..')) {
    throw new Error('path must be relative and stay inside the project folder');
  }
  return norm;
}
