import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { gradeAgent, gradeReadiness, readinessVerdict } from "./agent-report.mjs";

const { expected } = JSON.parse(await readFile(new URL("../benchmark/task.json", import.meta.url), "utf8"));
const empty = () => ({ nextIssueNumber: 1, issues: [] });
function goodEvidence() {
  const issue = { ...expected, id: "MOB-1", createdAt: "2026-11-08T00:00:00Z" };
  const state = { nextIssueNumber: 2, issues: [issue] };
  return structuredClone([
    { event: "started", state: empty() },
    { event: "reply", name: "create-issue", response: { structuredContent: { issue } }, state },
    { event: "reply", name: "get-issue", args: { id: issue.id },
      response: { structuredContent: { issue } }, beforeState: structuredClone(state), state },
    { event: "complete", finalText: "I did it", state },
  ].map(event => structuredClone(event)));
}

test("stored issue and a matching read are required; final text is not a grading input", () => {
  const events = goodEvidence();
  assert.deepEqual(gradeAgent(events, expected), { createdRequestedIssue: true, retrievedWithoutMutation: true });
  events.at(-1).finalText = "I did nothing";
  assert.deepEqual(gradeAgent(events, expected), { createdRequestedIssue: true, retrievedWithoutMutation: true });
  assert.deepEqual(gradeAgent([{ event: "complete", finalText: "Created MOB-1!", state: empty() }], expected),
    { createdRequestedIssue: false, retrievedWithoutMutation: false });
});

test("success replies without saved data cannot pass", () => {
  const events = goodEvidence();
  events.at(-1).state = empty();
  assert.equal(gradeAgent(events, expected).createdRequestedIssue, false);
});

test("wrong requested fields and duplicate issues fail creation", () => {
  const events = goodEvidence();
  events.at(-1).state.issues[0].assignee = "wrong@example.com";
  assert.equal(gradeAgent(events, expected).createdRequestedIssue, false);
  const duplicate = goodEvidence();
  duplicate.at(-1).state.issues.push(duplicate.at(-1).state.issues[0]);
  assert.equal(gradeAgent(duplicate, expected).createdRequestedIssue, false);
});

test("a read must follow creation, use its ID, and leave full state unchanged", () => {
  for (const mutate of [
    events => { events[2].args.id = "MOB-999"; },
    events => { events[2].response.isError = true; },
    events => { events[2].state.nextIssueNumber = 99; },
    events => { events[2].beforeState = null; },
    events => { [events[1], events[2]] = [events[2], events[1]]; },
  ]) {
    const events = goodEvidence(); mutate(events);
    assert.equal(gradeAgent(events, expected).retrievedWithoutMutation, false);
  }
});

test("missing or interrupted evidence stays unverified", () => {
  assert.deepEqual(gradeAgent([], expected), { createdRequestedIssue: null, retrievedWithoutMutation: null });
  const events = goodEvidence().slice(0, 2);
  events.push({ event: "timeout", state: events[1].state });
  assert.deepEqual(gradeAgent(events, expected), { createdRequestedIssue: true, retrievedWithoutMutation: null });
});

test("a completed model workflow cannot pass an evaluation that allowed anonymous writes", () => {
  const events = goodEvidence();
  events[0].identity = "anonymous";
  events.at(-1).event = "model_complete";
  const checks = gradeReadiness(events, expected);
  assert.equal(checks.createdRequestedIssue, true);
  assert.equal(checks.retrievedWithoutMutation, true);
  assert.equal(checks.rejectsAnonymousWrite, false);
  assert.equal(readinessVerdict(checks, true), "Blocked");
});

test("missing requirements prevent Ready even when the completed checks pass", () => {
  assert.equal(readinessVerdict({ workflow: true, auth: null }, true), "Unverified");
  assert.equal(readinessVerdict({ workflow: true, auth: true }, true), "Ready");
  assert.equal(readinessVerdict({ workflow: true, auth: true }, false), "Unverified");
});

test("retry and invalid-input checks inspect their full before and after state", () => {
  const events = goodEvidence();
  events.at(-1).event = "model_complete";
  const state = structuredClone(events.at(-1).state);
  const issue = state.issues[0];
  const probe = (step, response) => ({ event: "probe_reply", step, correlation: step,
    beforeState: structuredClone(state), state: structuredClone(state), response });
  events.push(probe("retry", { structuredContent: { issue, created: false, deduplicated: true } }));
  events.push(probe("invalid", { isError: true, content: [{ type: "text", text: "Input validation error: priority: Invalid option" }] }));
  events.push({ event: "probe_trace", records: [{ correlation: "invalid", tool: "create-issue", outcome: "validation_error", field: "priority" }] });
  let checks = gradeReadiness(events, expected);
  assert.equal(checks.retry, true);
  assert.equal(checks.validation, true);
  assert.equal(checks.trace, true);
  events.find(e => e.step === "invalid").state.nextIssueNumber = 99;
  checks = gradeReadiness(events, expected);
  assert.equal(checks.validation, false);
});
