# Launch assessment

Single-user local issue sandbox · deterministic SDK client · sequential retries.

Local demonstration — incomplete or failed gates. Public release — Blocked by anonymous write.

| Attempt evidence | Terminal event | Calls | fields | retrieval | retry | validation | trace | rejectsAnonymousWrite | tenantIsolation |
|---|---|---|---|---|---|---|---|---|---|
| [middleware-1](middleware-1/events.jsonl) | execution_error | 2 | Pass | Unverified | Unverified | Unverified | Unverified | Fail | Unverified |
| [middleware-2](middleware-2/events.jsonl) | execution_error | 2 | Pass | Unverified | Unverified | Unverified | Unverified | Fail | Unverified |
| [middleware-3](middleware-3/events.jsonl) | execution_error | 2 | Pass | Unverified | Unverified | Unverified | Unverified | Fail | Unverified |
| [boundary-1](boundary-1/events.jsonl) | execution_error | 2 | Pass | Unverified | Unverified | Unverified | Unverified | Fail | Unverified |
| [boundary-2](boundary-2/events.jsonl) | execution_error | 2 | Pass | Unverified | Unverified | Unverified | Unverified | Fail | Unverified |
| [boundary-3](boundary-3/events.jsonl) | execution_error | 2 | Pass | Unverified | Unverified | Unverified | Unverified | Fail | Unverified |

Compare the invalid reply and full state with the matching correlation ID in each attempt’s trace.jsonl. The only experimental change is enabling response-boundary tracing. Authentication rejection is a public launch blocker. Tenant isolation requires two identities.

Configuration and build digest: [manifest](manifest.json).
