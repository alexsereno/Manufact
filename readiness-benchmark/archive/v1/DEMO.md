# Five-minute demo walkthrough

## 0:00–0:45 — Frame the decision

Open `proposal.md` and explain the audience: an MCP owner with a working prototype deciding whether it is safe and reliable enough to launch. The benchmark complements Manufact's structural Quality Checker by testing user jobs, persisted outcomes, operational gates, and the fix/recheck loop.

## 0:45–1:30 — Show the controlled task

Open `scripts/run-benchmark.mjs` at `taskWording` and `expected`. Point out what stays constant: wording, initial state, test data, server version, MCP client, verifier, and three attempts. Only the labeled idempotency mode changes.

## 1:30–2:15 — Run it

```bash
npm run benchmark
```

Expected result:

```text
Benchmark complete: baseline 0/3, remediated 3/3.
```

This is a deterministic server demonstration, not an estimate of model reliability.

## 2:15–3:00 — Inspect independent evidence

Open `evidence/raw-results.json`. In baseline attempts, the repeated call creates `MOB-2` and the direct verifier finds two issues. In remediated attempts, the repeated call returns `MOB-1`, reports `deduplicated: true`, and the verifier finds exactly one persisted issue.

Open `benchmark/data/state.json` to show that the verifier reads business state outside the MCP response. The agent or tool cannot prove its own success merely by saying it succeeded.

## 3:00–3:45 — Show the remediation

Open `benchmark/store.ts`. Baseline mode always writes. Remediated mode looks up `externalId` and returns the existing issue without a second write. Explain that the baseline is an injected regression, clearly labeled because the original sampler did not contain an issue workflow to diagnose.

## 3:45–4:30 — Show the uncomfortable findings

Open `READINESS_REPORT.md`.

- Authentication is `Can't verify` and blocks a public launch.
- Validation failures are rejected correctly, but they do not appear in the server tool trace because schema validation happens before tool middleware. That observability check fails.
- There is no opaque readiness percentage. The report uses explicit gates and evidence.

## 4:30–5:00 — Connect to Manufact

Explain the activation path: public report → claim/submit server → connect or deploy → run first check → remediate → rerun → publishing workflow → retained production tool traffic. Manufact supplies deployment, cross-client testing, publishing checks, analytics, and evidence; the owner remains responsible for business logic, permissions, data handling, and domain safety.

Close with the narrow next step: validate the standard with three MCP owners, then add OAuth and run the exact same task in two real clients.
