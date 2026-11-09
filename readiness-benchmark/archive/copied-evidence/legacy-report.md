# MCP Production Readiness Benchmark — Working Slice

## Launch assessment

- **Intended use:** Local, authorized issue-management sandbox; not production data.
- **Intended users:** MCP server owners and builders preparing a user-facing launch.
- **Intended agent surfaces:** This measured slice uses the official TypeScript MCP client as a deterministic harness. ChatGPT, Claude, and coding-agent runs are proposed, not measured.
- **Overall conclusion:** **Ready for limited test launch.** The canonical task passes after remediation, but public production launch is blocked until authentication and authorization are implemented and independently tested.

Measured 2026-11-06T18:36:31.897Z. No model was used in the executed harness, so the three repeated attempts test server and verifier determinism, not agent reliability.

## 1. Critical findings

- **Authentication boundary — Can't verify / Blocker for public launch.** The local server deliberately has no OAuth or multi-user boundary. No claim about tenant isolation or least privilege is possible.
- **Duplicate creation — Baseline Fail / Blocker, remediated Pass.** The explicitly labeled baseline regression created two issues for one external id on all 3 attempts. The remediation returned the original issue on all 3 attempts.
- **Validation failures missing from server trace — Fail / Important.** All six invalid calls were rejected, but the tool middleware trace cannot see failures that happen during schema validation.

## 2. Production-readiness matrix

| Dimension | Check | Status | Severity | Evidence |
| --- | --- | --- | --- | --- |
| Functional readiness | Canonical issue job reaches verified final state | Pass | — | evidence/raw-results.json |
| Functional readiness | Repeated request does not create a duplicate | Pass | — | evidence/raw-results.json |
| Security and safety readiness | Invalid enum input is rejected before a write | Pass | — | evidence/raw-results.json |
| Security and safety readiness | Writes are confined to an authorized local sandbox | Pass | — | benchmark/data/state.json |
| Observability and operational readiness | Failed calls can be located in a server trace | Fail | Important | evidence/server-trace.jsonl |
| Authentication and authorization readiness | Sensitive write requires authenticated, least-privileged identity | Can't verify | Blocker | proposal.md#authentication-and-authorization-readiness |
| Deployment and release readiness | Server build is reproducible and version-identifiable | Pass | — | .mcp-use/build/index.js |

Summary: 5 pass, 1 fail, 1 can't verify, 0 not applicable. There is no aggregate score because this small slice has no defensible public weighting.

## 3. Canonical task result

> Create an issue for the checkout crash in the Mobile project, set priority high, assign alex.test@example.com, and retrieve it to confirm the final state. If the same request is retried, do not create a duplicate.

- Baseline: 0/3 independently verified successes.
- Remediated: 3/3 independently verified successes.
- Each attempt made five calls: reset, create, retry create, retrieve, and invalid-input probe.
- The verifier read persisted state directly; it did not accept the tool's success text as proof.

## 4. Evidence and trace

- [Raw results](./evidence/raw-results.json)
- [Machine-readable checks](./evidence/readiness-checks.json)
- [Server trace](./evidence/server-trace.jsonl)
- [Final sandbox state](./benchmark/data/state.json)

The trace records successful tool calls with inputs, server version, timestamp, duration, and outcome. Keys that resemble secrets, tokens, cookies, or authorization headers are redacted. The invalid-input failures appear in harness results but not in the server trace because schema validation occurs before tool middleware; that is reported as an observability gap. Token and cost data are unavailable because this deterministic slice does not invoke a model.

## 5. Before-and-after remediation

The baseline is an **injected, explicitly labeled regression** controlled by the reset fixture. In baseline mode, a repeated `externalId` creates a second issue. The remediation checks persisted state for that key and returns the original issue without writing. Task wording, test data, client, server process, verifier, and attempt count remain constant; only sandbox mode changes.

| Configuration | Verified successes | Duplicate count | Attribution |
| --- | ---: | ---: | --- |
| Baseline | 0/3 | 2, 2, 2 | Server defect (injected regression) |
| Remediated | 3/3 | 1, 1, 1 | Server remediation |

## 6. Known unknowns

- Authentication, authorization, tenant isolation, OAuth scope design, and destructive-action confirmation were not tested.
- No model, browser client, ChatGPT, Claude, or coding-agent configuration was measured.
- Local repeatability does not establish hosted availability, load capacity, rollback safety, store acceptance, or 30-day reliability.
- The benchmark has one workflow and one server; it does not support ecosystem-wide rankings.

## 7. Recommended next steps

1. Add OAuth and a two-user authorization boundary test, then keep failed access attempts in the trace without exposing credentials.
2. Run the exact canonical task in two real clients while holding server version, initial state, wording, data, and verifier constant.
3. Add ambiguous-request and recovery tasks only after validating the standard with three MCP owners.
4. Connect or deploy the server through Manufact and rerun the stable gates against a preview endpoint.
