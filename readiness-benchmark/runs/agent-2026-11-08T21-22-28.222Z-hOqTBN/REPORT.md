# MCP launch-readiness report

**Launch status: Blocked.**

Failed requirements: Reject anonymous writes.

Attempts: 3 scheduled, 3 Blocked, 0 Unverified, 0 Ready.

Missing required checks: Isolate tenants; Verify intended clients and integrations; Verify hosted release; Verify remaining safety requirements.

Evidence source: **live OpenAI API**. Model: **gpt-6-luna**. OpenAI Chat Completions.

## One evaluation

In each attempt, the model creates and retrieves the requested issue. On the same server, the runner then retries the write, submits an invalid priority, and attempts a new anonymous write. Code checks saved data and the rejected call's log. These are checks within one evaluation; any failed requirement blocks launch.

Model request: Create a high-priority issue in the Mobile project assigned to alex.test@example.com. Use request key BUG-MOBILE-CHECKOUT-001. Use this exact title: "Checkout crashes after payment confirmation". Use this exact description: "Confirming a valid test card payment closes the app before the receipt appears.". Retrieve the saved issue to confirm its details, then tell me its ID. This is synthetic test data in a local sandbox.

## Results by requirement

| Requirement | agent-1 | agent-2 | agent-3 |
| --- | --- | --- | --- |
| Create the requested issue | Pass | Pass | Pass |
| Retrieve without changing data | Pass | Pass | Pass |
| Retry without a duplicate | Pass | Pass | Pass |
| Reject invalid priority without changing data | Pass | Pass | Pass |
| Record the rejected call | Pass | Pass | Pass |
| Reject anonymous writes | Fail | Fail | Fail |
| Isolate tenants | Unverified | Unverified | Unverified |
| Verify intended clients and integrations | Unverified | Unverified | Unverified |
| Verify hosted release | Unverified | Unverified | Unverified |
| Verify remaining safety requirements | Unverified | Unverified | Unverified |

## Inspect every attempt

| Evidence | Execution | Launch status | Model requests | Model tool calls | Scripted calls | Prompt / completion tokens |
| --- | --- | --- | --- | --- | --- | --- |
| [agent-1](agent-1/events.jsonl) | complete | Blocked | 3 | 2 | 3 | 1898 / 117 |
| [agent-2](agent-2/events.jsonl) | complete | Blocked | 3 | 2 | 3 | 1898 / 113 |
| [agent-3](agent-3/events.jsonl) | complete | Blocked | 3 | 2 | 3 | 1898 / 125 |

- agent-1: [saved data](agent-1/state.json), [server log](agent-1/trace.jsonl). Returned model: gpt-6-luna.
- agent-2: [saved data](agent-2/state.json), [server log](agent-2/trace.jsonl). Returned model: gpt-6-luna.
- agent-3: [saved data](agent-3/state.json), [server log](agent-3/trace.jsonl). Returned model: gpt-6-luna.

## Next action and limits

Enforce authentication, then recheck with signed-in and anonymous clients. Authentication is deliberately absent in this synthetic sandbox. It demonstrates a known launch blocker, not a newly discovered customer vulnerability.

One task, one model, one client, local test data. The results do not establish overall security, general model quality, marketplace acceptance, or production reliability. Missing checks remain Unverified. No model judges the result; the stored outcomes and checking rules determine it.

The manifest saves prompts, settings, limits, versions, hashes, and the planned attempts. Each journal saves actual API replies, model-selected calls, scripted probes, and state snapshots. API keys and authorization headers are not saved.

[Configuration](manifest.json) · [Release decision](release.json) · [Checks](results.json) · [Counts](summary.json) · [Saved grader](verifier.mjs)

Regrade offline: node <run-directory>/verifier.mjs <run-directory>.
