# Model-driven MCP task report

Evidence source: **live OpenAI API**. Requested model: **gpt-6-luna**. API: OpenAI Chat Completions.

**Task result: 0/3 Pass, 0 Fail, 3 Unverified.**

**Launch readiness is not established by this task.** The separate scripted checks still determine authentication, retry, validation, and release findings.

## Task

Create a high-priority issue in the Mobile project assigned to alex.test@example.com. Use request key BUG-MOBILE-CHECKOUT-001. Use this exact title: "Checkout crashes after payment confirmation". Use this exact description: "Confirming a valid test card payment closes the app before the receipt appears.". Retrieve the saved issue to confirm its details, then tell me its ID. This is synthetic test data in a local sandbox.

The model chooses calls from tools discovered over MCP. Code checks the saved issue and a successful retrieval without state changes. Final assistant text is not a grading input.

## Every scheduled attempt

| Evidence | Execution | Task | Create correct issue | Retrieve without mutation | Model requests | MCP calls | Prompt / completion tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [agent-1](agent-1/events.jsonl) | execution_error | Unverified | Unverified | Unverified | 1 | 0 | 0 / 0 |
| [agent-2](agent-2/events.jsonl) | execution_error | Unverified | Unverified | Unverified | 1 | 0 | 0 / 0 |
| [agent-3](agent-3/events.jsonl) | execution_error | Unverified | Unverified | Unverified | 1 | 0 | 0 / 0 |

- agent-1: [saved data](agent-1/state.json), [server log](agent-1/trace.jsonl). Returned model: no response.
- agent-2: [saved data](agent-2/state.json), [server log](agent-2/trace.jsonl). Returned model: no response.
- agent-3: [saved data](agent-3/state.json), [server log](agent-3/trace.jsonl). Returned model: no response.

## Limits

One task, one model, one client, synthetic local data, anonymous MCP access. These counts describe only the scheduled attempts. They do not establish general model quality, server security, marketplace acceptance, or a production success rate. Model/API errors and incomplete evidence remain visible. No automatic API retries or model substitutions occur.

The manifest records the exact prompts, model settings, limits, versions, and source/build hashes. Each attempt records discovered tools. The journal retains request bodies, model replies, tool calls, and direct state snapshots. Authorization headers and API keys are not saved.

[Configuration](manifest.json) · [Checks](results.json) · [Counts](summary.json) · [Saved grader](verifier.mjs)

Regrade offline: `node <run-directory>/verifier.mjs <run-directory>`.
