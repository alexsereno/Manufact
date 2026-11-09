# MCP Production Readiness Benchmark by Manufact

## Recommendation

Serve **MCP server owners and builders first**: developers, API companies, and product teams that have a prototype or existing server they want people to use through ChatGPT, Claude, coding agents, and other MCP clients.

Their decision is concrete and urgent: **Is this MCP ready for users, what would prevent a safe and reliable launch, and which gaps should we address first?** A structurally valid server can still create duplicate state, leak data across users, fail in one client, or leave its operator unable to diagnose a bad session.

Position the benchmark as a public production-readiness standard, not another model leaderboard or opaque server score:

> What stands between this MCP prototype and a trustworthy production launch—and can each gap be verified, fixed, and rechecked?

Owners can trust it when tasks, initial state, configuration, verifiers, statuses, limitations, and raw traces are inspectable. They can share a result with gaps because it behaves like an engineering artifact: it defines intended use, distinguishes blockers from improvements, shows remediation, and gives a dated record of progress rather than branding a product “bad.”

Manufact is the natural next step when a finding requires preview deployment, authentication integration, cross-client testing, publishing checks, traces, analytics, or repeatable release checks. The report must remain useful without purchase; that independence is what makes the path to Manufact credible. Manufact supplies infrastructure and evidence, while the server owner remains responsible for business logic, permissions, data handling, and domain-specific safety.

## What exists and what this adds

| Existing approach | Question it answers | Verification method | Gap left for this proposal |
| --- | --- | --- | --- |
| [Manufact Quality Checker and leaderboard](https://manufact.com/leaderboard) | Is the server well-formed, discoverable, documented, and prepared for MCP and app requirements? | Automated inspection of protocol negotiation, capabilities, schemas, annotations, descriptions, and UI metadata | Structural quality does not establish that a user job reaches correct state, that permissions hold, or that operators can diagnose failures. Reuse these findings as preflight evidence; do not duplicate the score. |
| [Manufact cross-client testing](https://manufact.com/blog/how-to-measure-mcp-server-quality) | Does the same task behave across the clients users actually use? | Run a task in client configurations such as ChatGPT and Claude, then compare traces and outcomes | It is an execution capability, not yet a public production-readiness standard spanning verified jobs, launch gates, severity, and remediation. |
| [Supabase Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod), [Advisors](https://supabase.com/docs/guides/observability/advisors), [maturity model](https://supabase.com/docs/guides/deployment/maturity-model), and [Evals](https://supabase.com/evals) | What practices and project findings matter at each production stage, and can agents complete realistic Supabase work? | Explicit checklist; deterministic security, performance, and health checks; stage-aware guidance; realistic tasks scored with state checks, client calls, files, and selective model judgment | This is the operating-model precedent. MCP needs equivalent launch gates across protocol products and agent surfaces, not database-specific checks. |
| [MCPMark](https://github.com/eval-sys/mcpmark) | How capable are models and agents on deep, realistic MCP workflows? | 127 tasks across real tool environments, curated initial states, and programmatic verification | It primarily compares agent capability. A server owner still needs authentication, release, observability, and remediation gates for their own product. |
| [MCP Atlas](https://arxiv.org/abs/2602.00933) | How well do agents use real MCP servers at large scale? | Controlled tool exposure, reference trajectories, and claims-based scoring for single-turn, multi-call tasks | It benchmarks tool-use competency rather than certifying one server's intended launch conditions and operational evidence. |
| [Fiberplane Evals](https://docs.fiberplane.com/console/core-functionality/evals/) | Does an MCP scenario behave as expected, and how did the client use the server? | Scenario prompts, an MCP client, configurable scorers, transcripts, tool calls, scores, and cost | Strong workflow-eval tooling, but not a shared readiness standard combining functional outcomes with auth, security, deployment, and operations. |

The addition is a consistent MCP production-readiness standard combining **verified user jobs, launch-critical operational checks, actionable evidence, and a remediation/recheck loop**.

## Evaluation design

### Six dimensions

1. **Functional readiness:** representative jobs reach independently verified final state; invalid inputs, retries, and recoverable failures behave safely.
2. **Authentication and authorization readiness:** sensitive tools require appropriate identity and least privilege; users cannot cross data boundaries; secrets stay out of model-visible output and traces.
3. **Security and safety readiness:** annotations match behavior, inputs are validated, writes are confined and idempotent, destructive behavior is constrained, and external content remains data rather than instruction.
4. **Cross-client readiness:** the same job is measured as a complete model-plus-harness-plus-client configuration with versions and capabilities recorded.
5. **Deployment and release readiness:** builds are reproducible, version identity is visible, secrets are externalized, preview and rollback paths exist, and connection/publishing requirements are checked.
6. **Observability and operational readiness:** sessions can be reconstructed, failed calls can be located, versions and latency are recorded, and evidence distinguishes server, model, client, environment, and verifier limitations.

Every check returns **Pass**, **Fail**, **Can't verify**, or **Not applicable**. A failure is classified as **Blocker**, **Important**, or **Improvement** relative to the intended use. Each result includes why it matters, evidence, limitation, next action, Manufact applicability, and evidence path. “Can't verify” is never converted into a pass.

### Authentication and authorization readiness

For a public issue-writing server, authentication and least-privileged project authorization are launch blockers. The working slice intentionally uses an unauthenticated single-user fixture, so it reports this dimension as **Can't verify**. Passing requires a later two-user sandbox where unauthenticated access and cross-user reads/writes are rejected, authorized access succeeds, scopes are recorded, and neither evidence nor traces expose credentials.

### Representative issue-management tasks

1. **Happy path and retry — implemented:** create a high-priority Mobile issue assigned to the test user, retrieve it, and verify exact persisted state; a repeated request must not create a duplicate.
2. **Authorization boundary — proposed:** attempt the same write without project permission and verify rejection plus unchanged state.
3. **Ambiguous request — proposed:** omit priority and verify that the agent asks rather than guesses.
4. **Recovery — proposed:** make the first create call return a documented transient error and verify safe recovery without duplicate or partial state.
5. **Cross-client consistency — proposed:** run the unchanged happy-path wording and verifier in two real clients and report each complete configuration.

### Verification and attribution

The working slice separates three claims:

- The MCP response says what the tool believes happened.
- A retrieval call exercises the product's public read path.
- The deterministic verifier reads the sandbox state file outside MCP and compares exact fields and issue count.

For each failure, classify evidence as server defect, model behavior, harness/client behavior, environment/setup failure, verification/evidence limitation, or ambiguous. Do not force single-cause attribution when multiple material variables changed.

For a valid comparison, hold task wording, reset state, test data, server version, authentication, verifier, and run count constant. Record model, client, harness, and versions exactly. Change one material variable at a time where possible. Otherwise report a complete configuration comparison rather than “model A is better.” Report every attempt, not the best one.

## Measured working slice

The runnable project uses mcp-use 2.12.2 and the official TypeScript MCP client 2.3.1. It runs one local server over Streamable HTTP, writes only to an authorized JSON fixture, and executes three baseline plus three remediated attempts.

The baseline is an **injected and explicitly labeled idempotency regression**: repeating the same `externalId` creates another issue. It exists to demonstrate a fix/recheck loop because the original sampler contained no genuine issue workflow. The remediation returns the existing issue without writing.

Measured result in [READINESS_REPORT.md](./READINESS_REPORT.md):

- Baseline: 0/3 verified task successes; every retry created a duplicate.
- Remediated: 3/3 verified task successes; every retry returned the original issue.
- Invalid priority: rejected in 6/6 attempts without changing state.
- Authentication boundary: Can't verify and a blocker for public launch.
- Observability: Fail/Important because schema-validation failures are visible in harness evidence but not in server tool middleware traces.
- Token and cost data: unavailable because no model was invoked.

This establishes that the remediated local server deterministically completes this exact workflow under this client and verifier, validates the probed enum, confines writes locally, exposes a versioned build, and prevents sequential duplicates for one key.

It does **not** establish agent reliability, authentication security, tenant isolation, concurrent idempotency, behavior in ChatGPT or Claude, hosted availability, load capacity, rollback safety, marketplace acceptance, or production reliability. The run is a demonstration of the benchmark method, not an ecosystem comparison.

## Visitor-to-activation path

```text
Public readiness report
  → methodology and evidence opened
  → server submitted or existing report claimed
  → Manufact account created
  → server connected or deployed
  → first readiness check run
  → finding remediated
  → check rerun after release
  → publishing workflow started
  → first external tool call
  → production traffic retained after 30 days
```

Track:

```text
readiness_report_viewed
methodology_opened
server_submitted
report_claimed
manufact_account_created
server_connected_or_deployed
first_readiness_check_run
finding_remediated
check_rerun
publishing_workflow_started
first_external_tool_call
production_tool_call_retained_30d
```

Views, impressions, and raw eval counts show reach. Useful adoption requires a connected/deployed server, remediated finding, rerun, publishing start, external production call, or retained 30-day traffic. The core funnel should be measured from `readiness_report_viewed` to `server_connected_or_deployed`, then to `finding_remediated`, and finally to `production_tool_call_retained_30d`.

The growth loop is:

```text
Builder has an MCP prototype
  → useful assessment reveals credible launch gaps
  → evidence and remediation make the result actionable
  → builders and partners share the public method and result
  → builder uses Manufact for deployment, testing, publishing, or operations
  → production MCP traffic runs through Manufact
  → recurring findings improve the standard and public guidance
```

## Three potential launch partners

These are proposed partners; no outreach or interest is implied.

1. **AgentMail — MCP product/server partner.** Contributes a real email workflow and authorized sandbox where correct writes, retries, and permissions matter. Receives a credible public readiness artifact, workflow regressions, and launch guidance. It can trust the method because state verifiers and every configuration are inspectable, and share the result because remediation demonstrates engineering maturity even when gaps exist.
2. **OpenAI — client/harness partner.** Contributes ChatGPT client-surface expertise, MCP Apps behavior, and distribution to builders who need cross-client evidence. Receives reproducible reports that isolate server gaps from client/harness limitations. It can trust fixed tasks plus independent verifiers and share findings that improve ecosystem interoperability.
3. **WorkOS — authentication/integration partner.** Contributes OAuth, enterprise identity, scope, and authorization-boundary expertise. Receives a concrete MCP readiness profile showing where identity infrastructure becomes necessary. It can trust explicit shared responsibility and “can't verify” handling, and share a standard that makes production identity requirements actionable.

### Outreach draft to AgentMail

Subject: A verified production-readiness report for one AgentMail workflow

Hi AgentMail team — I'm prototyping MCP Production Readiness Benchmark by Manufact: a public, evidence-backed way for MCP owners to answer “what blocks a trustworthy launch, and did the fix work?”

I'd like to validate it with one narrow AgentMail sandbox workflow, defined with your team and run only against authorized test data. The result would include fixed task wording, exact configuration, an independent state verifier, raw trace evidence, explicit unknowns, and a remediation/recheck—not an opaque score or a model leaderboard.

AgentMail would get a reusable regression task and a public technical artifact it can review before anything is shared. Manufact would learn whether the standard captures real launch risks for a production MCP. Would you be open to a 30-minute methodology review and, if it holds up, one sandbox task?

— Alexander

### Launch post draft

**A valid MCP server is not automatically ready for users.**

Today we're sharing the first working slice of MCP Production Readiness Benchmark by Manufact: a public method for testing real user jobs, verifying resulting state outside the agent, exposing launch blockers, and rerunning checks after a fix.

The demo uses one intentionally narrow issue workflow. A retry initially created a duplicate in 3/3 runs. After an idempotency fix, the same task and verifier passed 3/3. Authentication remains unverified, and validation failures revealed a trace gap—both stay visible in the report.

No universal score. No best-run cherry-picking. Just explicit gates, raw evidence, known unknowns, and the next action.

We're looking for three MCP owners to challenge the standard with a real sandbox workflow. [methodology link] [report link]

## Following two weeks

### Week one: validate the standard

- Review the six dimensions and severity model with three MCP owners.
- Map existing Manufact Quality Checker evidence into preflight fields rather than rerunning structural checks.
- Add OAuth plus two-user authorization fixtures and one denied cross-user write/read task.
- Move validation failure capture to the transport boundary and add per-run correlation ids.
- Publish versioned result and trace schemas for review.

### Week two: test portability and activation

- Run the unchanged canonical task in two real clients or harnesses, recording full configurations.
- Add one ambiguous-request task and one recovery task only where deterministic state verification is possible.
- Connect or deploy the preview server through Manufact and test the report-to-rerun activation path.
- Conduct one partner methodology review; revise gates before adding more servers.
- Instrument the activation events and define 30-day retention reporting.

Deliberately leave out production-scale load testing, marketplace acceptance guarantees, automatic model routing, a universal ranking across unrelated products, a production frontend, and a large public dataset. Also leave scheduled checks and aggregate “common blocker” reporting until the schema and gates survive owner review.

Validate these assumptions first:

- Builders recognize findings as real launch risks and change behavior.
- The benchmark adds workflow and operational evidence rather than duplicating the Quality Checker.
- Critical checks can be automated or honestly labeled with reliable evidence boundaries.
- Findings are specific enough to drive a fix and rerun.
- Builders who fix issues become more likely to connect, deploy, publish, or operate through Manufact.
- Partners will contribute credible sandbox workflows and distribute reviewed results.

Change direction if owners dismiss the findings as generic, most checks collapse into existing Quality Checker output, critical checks cannot be reliably verified, remediation does not change behavior, conversion stops at report views, or partners will not provide workflows or distribution. In those cases, narrow the product to a Manufact-native release gate or a private diagnostic workflow instead of forcing a public benchmark.

## AI-use disclosure

Codex was used to review the assignment and implementation plan, research current primary sources, implement the local mcp-use server and deterministic harness, run type/build/lifecycle checks, generate evidence, and draft this proposal and demo guide. The measured benchmark itself does not use an LLM: the MCP calls and verifier are deterministic. All material claims in the report are backed by generated files in this repository or labeled as proposed, unavailable, or unverified. Alexander should be prepared to explain and modify the store, schemas, harness, verifier, and report generation during follow-up.
