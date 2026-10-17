# Ship It

One sentence in, a working Stripe-enabled app out. An agent writes and runs the code inside a CreateOS sandbox, so the generated code never touches your server.

## 1. Start from an empty directory (Stripe Projects)

```bash
mkdir ship-it && cd ship-it
stripe projects init ship-it
stripe projects catalog          # see what you can add
stripe projects add <provider>/<service>
stripe projects env --pull       # sync env vars
```

Then copy this project's files into the folder and run `stripe projects spend` before you submit, if the hackathon uses it for the leaderboard.

## 2. Configure

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `OPENAI_API_KEY`, plus `OPENAI_BASE_URL` (AgentRouter's OpenAI-compatible endpoint, `https://agentrouter.org/v1`)
- `STRIPE_TEST_KEY`: a restricted **test** key (`rk_test_...`). Live keys are rejected.
- `SANDBOX=local` while you build, `SANDBOX=createos` for the real demo.

## 3. Run

```bash
npm test     # policy and tool checks, no network needed
npm run dev  # http://localhost:8080
```

Needs Node 20.6 or newer.

## 4. Connect CreateOS (do this first, it is the one unverified part)

`src/sandbox.js` has a `CreateOSSandbox` class. Its routes and response fields are **placeholders**, because I could not check the CreateOS Sandbox API. Open the CreateOS docs and:

1. Replace the `ROUTES` block.
2. Fix the four lines marked `map response`.
3. Set `SANDBOX=createos`, `CREATEOS_API_BASE` and `CREATEOS_API_KEY`.
4. Confirm that the Stripe key reaches the sandbox as an environment variable or secret, and that outbound network is limited to Stripe and the packages host (npm).

Your sandbox also needs a public URL for port 3000. If CreateOS exposes this differently, change `publicUrl()` only.

`SANDBOX=local` runs commands on your own machine. It is for testing the agent loop, not for demos or untrusted prompts.

## How it works

```
Browser -- SSE --> server.js --> agent.js (LLM tool loop)
                                   |
                                   +-- tools.js --> policy.js (deny / ask / allow)
                                                      |
                                                      +--> sandbox.js --> CreateOS microVM
```

Tools: `write_file`, `run_command`, `read_logs`, `get_public_url`, `finish`.

## Safety layers

| Layer | What it does |
| --- | --- |
| Sandbox | Generated code runs in the CreateOS microVM, not on your server |
| Test keys only | The server refuses anything that is not `rk_test_` or `sk_test_` |
| Secrets | The key is passed to the sandbox as an environment value, never written to files. Commands that read it are blocked |
| Policy | `policy.js` denies dangerous commands and pauses risky ones for approval (60 seconds, then deny) |
| Limits | 25 steps, 300 second command cap, sandbox cleanup after 30 minutes |

The policy is a speed bump, not the boundary. Treat the sandbox and its network allowlist as the real security layer.

## Demo script (about 2 minutes)

1. Show the empty folder and the `stripe projects` commands.
2. Click "Barbershop deposit".
3. Watch the log: files written, a server start, an error, a fix.
4. Show one item in "What the sandbox stopped" (try a prompt that makes the agent want to `curl` an outside host and approve or deny it).
5. Open the app and pay with test card `4242 4242 4242 4242`.

Rehearse 3 prompts that work every time and use those on camera.

## Known limits

- The agent builds small Express apps only.
- Output is not reviewed for quality or accessibility.
- The curl check allows any command that mentions localhost, so a chained command could slip past it. The sandbox network allowlist is what actually stops outbound traffic.
