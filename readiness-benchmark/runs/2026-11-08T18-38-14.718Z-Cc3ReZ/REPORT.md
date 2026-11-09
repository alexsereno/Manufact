# Workflow report

Local issue sandbox. Scripted SDK client. No model. Sequential retries.

**Local workflow with boundary tracing: passes.**

**Public release: Blocked: an anonymous client persisted an issue.**

## Main finding

- middleware: failed-call trace 0 pass, 3 fail, 0 unverified; invalid-write check 3 pass, 0 fail, 0 unverified. Scheduled attempts: 3.
- boundary: failed-call trace 3 pass, 0 fail, 0 unverified; invalid-write check 3 pass, 0 fail, 0 unverified. Scheduled attempts: 3.

A trace failure means a readable trace lacks the required call, tool, or field. A missing trace is Unverified. The trace change does not fix anonymous access.

## All scheduled attempts

| Attempt evidence | Outcome | Calls | Observed call time (ms) | Create the requested issue | Retry without a duplicate | Retrieve without changing state | Reject invalid priority | Find the rejected call | Reject anonymous writes | Isolate tenants |
|---|---|---|---|---|---|---|---|---|---|---|
| [middleware-1](middleware-1/events.jsonl) | complete | 4 | 19.4 | Pass | Pass | Pass | Pass | Fail | Fail | Unverified |
| [boundary-1](boundary-1/events.jsonl) | complete | 4 | 14.1 | Pass | Pass | Pass | Pass | Pass | Fail | Unverified |
| [middleware-2](middleware-2/events.jsonl) | complete | 4 | 12.4 | Pass | Pass | Pass | Pass | Fail | Fail | Unverified |
| [boundary-2](boundary-2/events.jsonl) | complete | 4 | 12.6 | Pass | Pass | Pass | Pass | Pass | Fail | Unverified |
| [middleware-3](middleware-3/events.jsonl) | complete | 4 | 13.2 | Pass | Pass | Pass | Pass | Fail | Fail | Unverified |
| [boundary-3](boundary-3/events.jsonl) | complete | 4 | 14.6 | Pass | Pass | Pass | Pass | Pass | Fail | Unverified |

## Counts by configuration

P/F/U = Pass / Fail / Unverified. Every scheduled attempt stays in the denominator.

| Configuration | Scheduled | Complete | Errors | Timeouts | Interrupted | Incomplete |
|---|---|---|---|---|---|---|
| middleware | 3 | 3 | 0 | 0 | 0 | 0 |
| boundary | 3 | 3 | 0 | 0 | 0 | 0 |

| Check | middleware P/F/U | boundary P/F/U |
|---|---|---|
| Create the requested issue | 3/0/0 | 3/0/0 |
| Retry without a duplicate | 3/0/0 | 3/0/0 |
| Retrieve without changing state | 3/0/0 | 3/0/0 |
| Reject invalid priority | 3/0/0 | 3/0/0 |
| Find the rejected call | 0/3/0 | 3/0/0 |
| Reject anonymous writes | 0/3/0 | 0/3/0 |
| Isolate tenants | 0/0/3 | 0/0/3 |

## Inspect the evidence

Compare the invalid call's reply and state with the preceding retrieval snapshot. Find the same correlation ID in the attempt's trace.jsonl. Middleware-only capture misses schema validation before tool middleware runs; boundary capture records that error.

- middleware-1: [journal](middleware-1/events.jsonl), [trace](middleware-1/trace.jsonl), [final store](middleware-1/state.json).
- boundary-1: [journal](boundary-1/events.jsonl), [trace](boundary-1/trace.jsonl), [final store](boundary-1/state.json).
- middleware-2: [journal](middleware-2/events.jsonl), [trace](middleware-2/trace.jsonl), [final store](middleware-2/state.json).
- boundary-2: [journal](boundary-2/events.jsonl), [trace](boundary-2/trace.jsonl), [final store](boundary-2/state.json).
- middleware-3: [journal](middleware-3/events.jsonl), [trace](middleware-3/trace.jsonl), [final store](middleware-3/state.json).
- boundary-3: [journal](boundary-3/events.jsonl), [trace](boundary-3/trace.jsonl), [final store](boundary-3/state.json).


## Limits and next action

These are local observations, not a production success rate. Call times describe these attempts, not hosted performance. Tenant isolation, model planning, concurrent retries, cross-client behavior, and hosted reliability remain unverified. Enforce identity before public release, then test allowed and denied writes with two identities.

[Configuration and hashes](manifest.json) · [Machine-readable checks](results.json) · [Counts](summary.json)

[Exact task and rules](task.json) · [Grader used for this run](verifier.mjs)

Regenerate offline: `node <run-directory>/verifier.mjs <run-directory>`.
