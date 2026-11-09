# MCP Production Readiness Benchmark — working slice

This project is the runnable demonstration for Alexander Sereno's Manufact Developer Advocate & Partnerships assignment. It evaluates one issue-management job against explicit production-readiness gates, preserves raw evidence, fixes one blocker, and reruns the same check.

It is intentionally small. The measured slice uses a deterministic MCP client rather than an LLM, writes only to a local JSON sandbox, and makes no claims about real-client or production reliability.

## What it demonstrates

- A real MCP server running over Streamable HTTP
- A canonical create-and-retrieve issue job
- Independent verification by reading persisted state outside MCP
- Three baseline and three remediated attempts
- Input validation, sandbox confinement, build identity, and trace checks
- An explicitly labeled injected idempotency regression and concrete remediation
- Honest `Pass`, `Fail`, and `Can't verify` results

Start with [the readiness report](./READINESS_REPORT.md) and [the proposal](./proposal.md).

## Requirements

- Node.js 22.22.2 or later
- npm
- Ports 3000 and 3100 available for the optional Inspector and automated harness

No API keys, model credentials, customer accounts, or external services are required.

## Reproduce the measured result

```bash
npm install
npm run typecheck
npm run benchmark
```

`npm run benchmark` builds the production bundle, starts it locally on port 3100, executes six attempts, writes evidence, generates `READINESS_REPORT.md`, and stops the server. Expected final console result:

```text
Benchmark complete: baseline 0/3, remediated 3/3.
```

Generated evidence:

- `evidence/raw-results.json` — every attempt and controlled configuration
- `evidence/readiness-checks.json` — machine-readable readiness findings
- `evidence/server-trace.jsonl` — server-side call evidence
- `evidence/server-output.txt` — local server startup and request log
- `benchmark/data/state.json` — independently verified final state

Timestamps and durations will change on each run. Do not compare those as functional changes.

## Explore the server interactively

```bash
npm run dev
```

Then open [http://localhost:3000/mcp/inspector](http://localhost:3000/mcp/inspector). The canonical sequence is:

1. Call `benchmark-reset` with `{"mode":"remediated"}`.
2. Call `create-issue` with:

   ```json
   {
     "externalId": "BUG-MOBILE-CHECKOUT-001",
     "title": "Checkout crashes after payment confirmation",
     "description": "On the test build, confirming a valid card payment closes the Mobile app before the receipt appears.",
     "project": "Mobile",
     "priority": "high",
     "assignee": "alex.test@example.com"
   }
   ```

3. Repeat the same `create-issue` call. The second result should have `created: false`, `deduplicated: true`, and the same issue id.
4. Call `get-issue` with that id.
5. Inspect `benchmark/data/state.json`; there should be exactly one matching issue.

The full five-minute walkthrough is in [DEMO.md](./DEMO.md).

## Implementation map

- `index.ts` — MCP server, tools, schemas, annotations, and trace middleware
- `benchmark/store.ts` — local fixture state and idempotency remediation
- `benchmark/trace.ts` — redacted JSONL tool traces
- `scripts/run-benchmark.mjs` — MCP client, repeated attempts, independent verifier, findings, and report generation
- `proposal.md` — audience, methodology, market context, growth plan, partners, and two-week plan

## Scope boundaries

The benchmark does not test authentication, multi-user authorization, real agent behavior, cross-client behavior, hosted availability, concurrency, load, rollback, marketplace acceptance, or long-term production traffic. Those omissions are findings or proposed next steps, not passes.

The local `baseline` mode is an injected regression used only to demonstrate the remediation/recheck loop. It intentionally creates a duplicate on retry and is labeled as such in every report.
