import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual as equal } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function gradeAgent(events, expected) {
  const terminal = events.at(-1);
  const finalState = terminal?.state;
  const hasState = Array.isArray(finalState?.issues);
  const saved = finalState?.issues?.[0];
  const replies = events.filter(e => e.event === "reply");
  const created = replies.find(e => e.name === "create-issue" && e.response?.isError !== true &&
    saved && equal(e.response?.structuredContent?.issue, saved) &&
    e.state?.issues?.length === 1 && equal(e.state.issues[0], saved));
  const fieldsMatch = hasState && finalState.issues.length === 1 &&
    Object.entries(expected).every(([key, value]) => saved?.[key] === value);
  const retrieved = replies.some(e => e.name === "get-issue" && e.response?.isError !== true &&
    created && events.indexOf(e) > events.indexOf(created) && e.args?.id === saved?.id &&
    equal(e.response?.structuredContent?.issue, saved) && Array.isArray(e.beforeState?.issues) &&
    equal(e.beforeState, e.state));
  const completed = terminal?.event === "complete";
  return {
    createdRequestedIssue: hasState && (saved || completed) ? Boolean(fieldsMatch && created) : null,
    retrievedWithoutMutation: retrieved ? true : completed && hasState ? false : null,
  };
}

async function readJournal(file) {
  const events = [];
  try {
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line));
    }
    return { events, error: null };
  } catch {
    return { events, error: "Journal is missing or truncated; preceding records retained." };
  }
}

export const CHECK_LABELS = {
  createdRequestedIssue: "Create the requested issue",
  retrievedWithoutMutation: "Retrieve without changing data",
  retry: "Retry without a duplicate",
  validation: "Reject invalid priority without changing data",
  trace: "Record the rejected call",
  rejectsAnonymousWrite: "Reject anonymous writes",
  tenantIsolation: "Isolate tenants",
  crossClient: "Verify intended clients and integrations",
  deployment: "Verify hosted release",
  security: "Verify remaining safety requirements",
};

export function gradeReadiness(events, expected) {
  const modelEnd = events.findIndex(e => e.event === "model_complete");
  const firstProbe = events.findIndex(e => e.event === "probe_call");
  const modelEvents = modelEnd >= 0
    ? events.slice(0, modelEnd + 1).map(e => e.event === "model_complete" ? { ...e, event: "complete" } : e)
    : events.slice(0, firstProbe >= 0 ? firstProbe : events.length);
  const workflow = gradeAgent(modelEvents, expected);
  const modelState = modelEvents.at(-1)?.state;
  const issue = modelState?.issues?.[0];
  const probes = Object.fromEntries(events.filter(e => e.event === "probe_reply").map(e => [e.step, e]));
  const { retry, invalid, anonymous } = probes;
  const stateKnown = e => Array.isArray(e?.beforeState?.issues) && Array.isArray(e?.state?.issues);
  const text = e => (e?.response?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");
  const trace = events.findLast(e => e.event === "probe_trace")?.records;
  const initial = events.find(e => e.event === "started");
  const anonymousWrite = initial?.identity === "anonymous" && Array.isArray(initial.state?.issues) &&
    events.some(e => Array.isArray(e.state?.issues) && e.state.issues.length > initial.state.issues.length);
  return {
    ...workflow,
    retry: retry?.response && stateKnown(retry) && issue ? Boolean(
      retry.response.isError !== true && retry.response.structuredContent?.created === false &&
      retry.response.structuredContent?.deduplicated === true &&
      equal(retry.response.structuredContent?.issue, issue) && equal(retry.beforeState, retry.state)) : null,
    validation: invalid?.response && stateKnown(invalid) ? Boolean(
      invalid.response.isError === true && /input validation error.*priority: invalid/is.test(text(invalid)) &&
      equal(invalid.beforeState, invalid.state)) : null,
    trace: invalid?.response && Array.isArray(trace) ? trace.some(record =>
      record.correlation === invalid.correlation && record.tool === "create-issue" &&
      record.outcome === "validation_error" && record.field === "priority") : null,
    rejectsAnonymousWrite: anonymousWrite ? false : initial?.identity === "anonymous" &&
      anonymous?.response && stateKnown(anonymous) ? Boolean(
        anonymous.response.isError === true && /unauthori|forbidden/i.test(text(anonymous)) &&
        equal(anonymous.beforeState, anonymous.state)) : null,
    tenantIsolation: null, crossClient: null, deployment: null, security: null,
  };
}

export function readinessVerdict(checks, completed, evidenceErrors = []) {
  if (Object.values(checks).some(value => value === false)) return "Blocked";
  if (!completed || evidenceErrors.length || Object.values(checks).some(value => value == null)) return "Unverified";
  return "Ready";
}

export async function agentReport(dir) {
  const manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8"));
  const rows = [];
  for (const id of manifest.attempts) {
    const { events, error } = await readJournal(resolve(dir, id, "events.jsonl"));
    const checks = gradeReadiness(events, manifest.expected);
    const terminal = events.at(-1)?.event ?? "not_started";
    const evidenceErrors = [error, ...events.filter(e => e.stateError).map(e => e.stateError)].filter(Boolean);
    const verdict = readinessVerdict(checks, terminal === "complete", evidenceErrors);
    const modelReplies = events.filter(e => e.event === "model_reply");
    rows.push({ id, terminal, verdict, checks, evidenceErrors,
      modelToolCalls: events.filter(e => e.event === "call").length,
      scriptedCalls: events.filter(e => e.event === "probe_call").length,
      modelRequests: events.filter(e => e.event === "model_request").length,
      returnedModels: [...new Set(modelReplies.map(e => e.completion.model).filter(Boolean))],
      tokenUsage: modelReplies.reduce((sum, e) => ({
        prompt: sum.prompt + (e.completion.usage?.prompt_tokens ?? 0),
        completion: sum.completion + (e.completion.usage?.completion_tokens ?? 0),
      }), { prompt: 0, completion: 0 }),
    });
  }
  const summary = { scheduled: rows.length,
    ready: rows.filter(row => row.verdict === "Ready").length,
    blocked: rows.filter(row => row.verdict === "Blocked").length,
    unverified: rows.filter(row => row.verdict === "Unverified").length };
  const required = manifest.requiredChecks ?? Object.keys(CHECK_LABELS);
  const blockers = required.filter(key => rows.some(row => row.checks[key] === false));
  const unverified = required.filter(key => !rows.length || rows.some(row => row.checks[key] == null));
  const status = blockers.length ? "Blocked" : !rows.length || rows.some(row => row.verdict !== "Ready") ? "Unverified" : "Ready";
  const release = { scope: manifest.releaseScope, status, blockers, unverified };
  const label = value => value == null ? "Unverified" : value ? "Pass" : "Fail";
  const lines = ["# MCP launch-readiness report", "",
    "**Launch status: " + status + ".**", "",
    blockers.length ? "Failed requirements: " + blockers.map(key => CHECK_LABELS[key]).join("; ") + "."
      : "No failed requirement has been observed.", "",
    "Attempts: " + summary.scheduled + " scheduled, " + summary.blocked + " Blocked, " + summary.unverified +
      " Unverified, " + summary.ready + " Ready.", "",
    "Missing required checks: " + (unverified.map(key => CHECK_LABELS[key]).join("; ") || "none") + ".", "",
    "Evidence source: **" + manifest.evidenceSource + "**. Model: **" + manifest.model + "**. OpenAI Chat Completions.", "",
    "## One evaluation", "",
    "In each attempt, the model creates and retrieves the requested issue. On the same server, the runner then retries the write, submits an invalid priority, and attempts a new anonymous write. Code checks saved data and the rejected call's log. These are checks within one evaluation; any failed requirement blocks launch.", "",
    "Model request: " + manifest.prompt, "",
    "## Results by requirement", "",
    "| Requirement | " + rows.map(row => row.id).join(" | ") + " |",
    "|" + Array(rows.length + 1).fill(" --- ").join("|") + "|",
    ...required.map(key => "| " + CHECK_LABELS[key] + " | " + rows.map(row => label(row.checks[key])).join(" | ") + " |"), "",
    "## Inspect every attempt", "",
    "| Evidence | Execution | Launch status | Model requests | Model tool calls | Scripted calls | Prompt / completion tokens |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(row => "| [" + row.id + "](" + row.id + "/events.jsonl) | " + row.terminal + " | " + row.verdict +
      " | " + row.modelRequests + " | " + row.modelToolCalls + " | " + row.scriptedCalls +
      " | " + row.tokenUsage.prompt + " / " + row.tokenUsage.completion + " |"), "",
    ...rows.map(row => "- " + row.id + ": [saved data](" + row.id + "/state.json), [server log](" +
      row.id + "/trace.jsonl). Returned model: " + (row.returnedModels.join(", ") || "no response") + "."),
    ...rows.filter(row => row.evidenceErrors.length).map(row => "- " + row.id + ": " + row.evidenceErrors.join(" ")), "",
    "## Next action and limits", "",
    "Enforce authentication, then recheck with signed-in and anonymous clients. Authentication is deliberately absent in this synthetic sandbox. It demonstrates a known launch blocker, not a newly discovered customer vulnerability.", "",
    "One task, one model, one client, local test data. The results do not establish overall security, general model quality, marketplace acceptance, or production reliability. Missing checks remain Unverified. No model judges the result; the stored outcomes and checking rules determine it.", "",
    "The manifest saves prompts, settings, limits, versions, hashes, and the planned attempts. Each journal saves actual API replies, model-selected calls, scripted probes, and state snapshots. API keys and authorization headers are not saved.", "",
    "[Configuration](manifest.json) · [Release decision](release.json) · [Checks](results.json) · [Counts](summary.json) · [Saved grader](verifier.mjs)", "",
    "Regrade offline: node <run-directory>/verifier.mjs <run-directory>.", "",
  ];
  await writeFile(resolve(dir, "REPORT.md"), lines.join("\n"));
  for (const [file, value] of Object.entries({ "results.json": rows, "summary.json": summary, "release.json": release })) {
    await writeFile(resolve(dir, file), JSON.stringify(value, null, 2) + "\n");
  }
  console.log("Launch status: " + status + ". " + summary.blocked + "/" + summary.scheduled + " attempts Blocked. Evidence: " + dir);
  return { rows, summary, release };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/agent-report.mjs <run-directory>");
  await agentReport(resolve(process.argv[2]));
}
