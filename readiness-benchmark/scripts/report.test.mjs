import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grade, summarize, assessRelease, report } from "./report.mjs";

const { expected } = JSON.parse(await readFile(new URL("../benchmark/task.json", import.meta.url), "utf8"));
function fixture() {
  const initial = { nextIssueNumber: 1, issues: [] };
  const issue = { ...expected, id: "MOB-1", createdAt: "2026-11-08T00:00:00.000Z" };
  const state = { nextIssueNumber: 2, issues: [issue] };
  const reply = (step, response) => ({ event: "reply", step, correlation: step, response, state: structuredClone(state) });
  const events = [
    { event: "started", state: initial },
    reply("create", { structuredContent: { issue }, content: [] }),
    reply("retry", { structuredContent: { issue, created: false, deduplicated: true }, content: [] }),
    reply("retrieve", { structuredContent: { issue }, content: [] }),
    reply("invalid", { isError: true, content: [{ type: "text", text: "Input validation error: priority: Invalid option" }] }),
    { event: "complete" },
  ];
  const trace = [{ correlation: "invalid", tool: "create-issue", outcome: "validation_error", field: "priority" }];
  return { events: structuredClone(events), trace };
}

test("valid local evidence passes; anonymous write remains a release failure", () => {
  const { events, trace } = fixture();
  assert.deepEqual(grade(events, trace, expected), {
    fields: true, retry: true, retrieval: true, validation: true, trace: true,
    rejectsAnonymousWrite: false, tenantIsolation: null, crossClient: null, deployment: null, security: null,
  });
});

test("success text cannot substitute for a stored issue", () => {
  const { events, trace } = fixture();
  events[1].state.issues = [];
  events[1].response.content = [{ type: "text", text: "Created successfully" }];
  assert.equal(grade(events, trace, expected).fields, false);
});

test("retry fails if it returns changed fields despite the same issue ID", () => {
  const { events, trace } = fixture();
  events[2].response.structuredContent.issue.priority = "low";
  assert.equal(grade(events, trace, expected).retry, false);
});

test("retrieval fails if a read changes any stored state", () => {
  const { events, trace } = fixture();
  events[3].state.nextIssueNumber = 3;
  assert.equal(grade(events, trace, expected).retrieval, false);
});

test("an error flag cannot count as a successful retrieval", () => {
  const { events, trace } = fixture();
  events[3].response.isError = true;
  assert.equal(grade(events, trace, expected).retrieval, false);
});

test("a rejected invalid write fails if any state changed", () => {
  const { events, trace } = fixture();
  events[4].state.nextIssueNumber = 99;
  assert.equal(grade(events, trace, expected).validation, false);
});

test("missing trace is unverified; readable trace without the error fails", () => {
  const { events } = fixture();
  assert.equal(grade(events, null, expected).trace, null);
  assert.equal(grade(events, [], expected).trace, false);
});

test("an unrelated trace event cannot satisfy the failed-call check", () => {
  const { events, trace } = fixture();
  trace[0].correlation = "different-call";
  assert.equal(grade(events, trace, expected).trace, false);
});

test("interruption keeps the committed write and leaves later checks unverified", () => {
  const { events, trace } = fixture();
  const checks = grade(events.slice(0, 2), trace, expected);
  assert.equal(checks.fields, true);
  assert.equal(checks.rejectsAnonymousWrite, false);
  for (const key of ["retry", "retrieval", "validation", "trace"]) assert.equal(checks[key], null);
});

test("missing state cannot be counted as an observed violation", () => {
  const { events, trace } = fixture();
  events[4].state = null;
  assert.equal(grade(events, trace, expected).validation, null);
});

test("all outcomes and unverified checks remain in summary counts", () => {
  const rows = [
    { mode: "boundary", terminal: "complete", checks: { trace: true } },
    { mode: "boundary", terminal: "complete", checks: { trace: false } },
    { mode: "boundary", terminal: "timeout", checks: { trace: null } },
    { mode: "boundary", terminal: "interrupted", checks: { trace: null } },
    { mode: "boundary", terminal: "execution_error", checks: { trace: null } },
    { mode: "boundary", terminal: "not_started", checks: { trace: null } },
  ];
  const [summary] = summarize(rows);
  assert.equal(summary.scheduled, 6);
  assert.equal(summary.complete, 2);
  assert.equal(summary.timeouts, 1);
  assert.equal(summary.interruptions, 1);
  assert.equal(summary.executionErrors, 1);
  assert.equal(summary.incomplete, 1);
  assert.deepEqual(summary.checks.trace, { pass: 1, fail: 1, unverified: 4 });
});

test("stored anonymous write blocks launch even if the client never got a reply", () => {
  const { events, trace } = fixture();
  const lostReply = [events[0], { event: "timeout", state: events[1].state }];
  const checks = grade(lostReply, trace, expected);
  assert.equal(checks.fields, null);
  assert.equal(checks.rejectsAnonymousWrite, false);
});

test("a known blocker takes precedence over missing readiness checks", () => {
  const release = assessRelease([{ terminal: "complete", checks: { auth: false, identity: null } }], ["auth", "identity"]);
  assert.equal(release.status, "Blocked");
  assert.deepEqual(release.blockers, ["auth"]);
  assert.deepEqual(release.unverified, ["identity"]);
});

test("local success cannot establish readiness when required evidence is absent", () => {
  const release = assessRelease([{ terminal: "complete", checks: { workflow: true, clients: null } }], ["workflow", "clients"]);
  assert.equal(release.status, "Unverified");
  assert.equal(assessRelease([], ["workflow"]).status, "Unverified");
});

test("ready requires all scheduled candidate attempts and all required checks to pass", () => {
  const row = { terminal: "complete", evidenceErrors: [], checks: { workflow: true, auth: true } };
  assert.equal(assessRelease([row], ["workflow", "auth"]).status, "Ready");
  assert.equal(assessRelease([row, { ...row, terminal: "timeout" }], ["workflow", "auth"]).status, "Unverified");
  assert.equal(assessRelease([{ ...row, evidenceErrors: ["missing trace"] }], ["workflow", "auth"]).status, "Unverified");
});

test("offline reporting retains completed evidence before a truncated journal line", async t => {
  const dir = await mkdtemp(join(tmpdir(), "manufact-grader-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { events, trace } = fixture();
  await mkdir(join(dir, "boundary-1"));
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ expected,
    configurations: [{ id: "boundary-1", mode: "boundary" }, { id: "boundary-2", mode: "boundary" }] }));
  await writeFile(join(dir, "boundary-1", "events.jsonl"), events.map(JSON.stringify).join("\n") + '\n{"event":');
  await writeFile(join(dir, "boundary-1", "trace.jsonl"), trace.map(JSON.stringify).join("\n") + "\n");
  const result = await report(dir);
  assert.equal(result.rows[0].checks.fields, true);
  assert.equal(result.rows[0].checks.rejectsAnonymousWrite, false);
  assert.match(result.rows[0].evidenceErrors[0], /preceding records retained/);
  assert.equal(result.ready, false);
  assert.equal(result.rows[1].terminal, "not_started");
  assert.equal(result.rows[1].checks.fields, null);
  assert.equal(result.summary[0].scheduled, 2);
  assert.equal(result.release.status, "Blocked");
});

test("an absent trace artifact is unverified in the generated report", async t => {
  const dir = await mkdtemp(join(tmpdir(), "manufact-grader-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { events } = fixture();
  await mkdir(join(dir, "boundary-1"));
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ expected,
    configurations: [{ id: "boundary-1", mode: "boundary" }] }));
  await writeFile(join(dir, "boundary-1", "events.jsonl"), events.map(JSON.stringify).join("\n") + "\n");
  const result = await report(dir);
  assert.equal(result.rows[0].checks.trace, null);
  assert.equal(result.summary[0].checks.trace.unverified, 1);
  assert.equal(result.ready, false);
});
