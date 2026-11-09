import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual as equal } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function records(file) {
  try {
    const parsed = [];
    const lines = (await readFile(file, "utf8")).split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try { parsed.push(JSON.parse(lines[i])); }
      catch {
        return { records: parsed, error: `${file.split("/").slice(-2).join("/")}: unreadable line ${i + 1}; preceding records retained` };
      }
    }
    return { records: parsed };
  } catch (error) {
    return { records: null, error: `${file.split("/").slice(-2).join("/")}: ${error.message}` };
  }
}

// Null means missing evidence, never an inferred pass or an observed violation.
export function grade(events, trace, expected) {
  const replies = Object.fromEntries(events.filter(e => e.event === "reply").map(e => [e.step, e]));
  const { create, retry, retrieve, invalid } = replies;
  const initial = events.find(e => e.event === "started")?.state;
  const first = create?.response?.structuredContent?.issue;
  const saved = create?.state?.issues?.[0];
  const duplicate = retry?.response?.structuredContent;
  const success = reply => reply?.response && reply.response.isError !== true;
  const hasState = reply => Array.isArray(reply?.state?.issues);
  const hasReply = reply => reply?.response && hasState(reply);
  const text = reply => (reply?.response?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");
  const anonymousWriteObserved = initial?.issues?.length === 0 &&
    events.some(event => event.state?.issues?.length > 0);

  return {
    fields: hasReply(create) ? Boolean(success(create) && first && saved &&
      create.state.issues.length === 1 && equal(first, saved) &&
      Object.entries(expected).every(([key, value]) => saved[key] === value)) : null,
    retry: hasReply(retry) && hasState(create) ? Boolean(success(retry) && saved &&
      equal(duplicate?.issue, saved) && duplicate?.created === false &&
      duplicate?.deduplicated === true && equal(create.state, retry.state)) : null,
    retrieval: hasReply(retrieve) && hasState(retry) && hasState(create) ? Boolean(
      success(retrieve) && saved && equal(retrieve.response.structuredContent?.issue, saved) &&
      equal(retrieve.state, retry.state)) : null,
    validation: hasReply(invalid) && hasState(retrieve) ? Boolean(invalid.response.isError === true &&
      /input validation error.*priority: invalid/is.test(text(invalid)) &&
      equal(invalid.state, retrieve.state)) : null,
    trace: invalid?.response && Array.isArray(trace) ? trace.some(t =>
      t.correlation === invalid.correlation && t.tool === "create-issue" &&
      t.outcome === "validation_error" && t.field === "priority") : null,
    rejectsAnonymousWrite: anonymousWriteObserved ? false : hasReply(create) && initial ? Boolean(
      create.response.isError === true && /unauthori|forbidden/i.test(text(create)) &&
      equal(create.state, initial)) : null,
    tenantIsolation: null,
    crossClient: null,
    deployment: null,
    security: null,
  };
}

export function assessRelease(rows, requiredChecks) {
  const blockers = requiredChecks.filter(key => rows.some(row => row.checks[key] === false));
  const unverified = requiredChecks.filter(key => rows.length === 0 || rows.some(row => row.checks[key] == null));
  const incompleteEvidence = rows.length === 0 || rows.some(row =>
    row.terminal !== "complete" || row.evidenceErrors?.length > 0);
  return {
    status: blockers.length ? "Blocked" : unverified.length || incompleteEvidence ? "Unverified" : "Ready",
    blockers, unverified, incompleteEvidence,
  };
}

export function summarize(rows) {
  return [...new Set(rows.map(row => row.mode))].map(mode => {
    const attempts = rows.filter(row => row.mode === mode);
    const counts = Object.fromEntries(Object.keys(attempts[0].checks).map(key => [key, {
      pass: attempts.filter(row => row.checks[key] === true).length,
      fail: attempts.filter(row => row.checks[key] === false).length,
      unverified: attempts.filter(row => row.checks[key] === null).length,
    }]));
    return {
      mode, scheduled: attempts.length,
      complete: attempts.filter(row => row.terminal === "complete").length,
      executionErrors: attempts.filter(row => row.terminal === "execution_error").length,
      timeouts: attempts.filter(row => row.terminal === "timeout").length,
      interruptions: attempts.filter(row => row.terminal === "interrupted").length,
      incomplete: attempts.filter(row => !["complete", "execution_error", "timeout", "interrupted"].includes(row.terminal)).length,
      checks: counts,
    };
  });
}

export async function report(dir) {
  const manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8"));
  const rows = [];
  for (const { id, mode } of manifest.configurations) {
    const journal = await records(resolve(dir, id, "events.jsonl"));
    const trace = await records(resolve(dir, id, "trace.jsonl"));
    const events = journal.records ?? [];
    rows.push({
      id, mode, terminal: events.at(-1)?.event ?? "not_started",
      calls: events.filter(e => e.event === "call").length,
      observedCallDurationMs: events.filter(e => e.event === "reply").reduce((sum, e) => sum + (e.durationMs ?? 0), 0),
      evidenceErrors: [journal.error, trace.error, ...events.filter(e => e.stateError).map(e => e.stateError)].filter(Boolean),
      checks: grade(events, trace.error ? null : trace.records, manifest.expected),
    });
  }
  const summary = summarize(rows);
  const scope = manifest.task?.releaseScope;
  const current = rows.filter(row => row.mode === (scope?.candidateMode ?? "boundary"));
  const localChecks = ["fields", "retry", "retrieval", "validation", "trace"];
  const ready = current.length > 0 && current.every(row => row.terminal === "complete" &&
    row.evidenceErrors.length === 0 && localChecks.every(key => row.checks[key] === true));
  const release = assessRelease(current, scope?.requiredChecks ?? Object.keys(rows[0]?.checks ?? {}));
  const labels = value => value === null ? "Unverified" : value ? "Pass" : "Fail";
  const workflowLabel = row => {
    const values = ["fields", "retry", "retrieval", "validation"].map(key => row.checks[key]);
    return labels(values.some(value => value === false) ? false : values.some(value => value == null) ? null : true);
  };
  const columns = Object.keys(rows[0]?.checks ?? {});
  const titles = Object.fromEntries(columns.map(key => [key, manifest.task?.checks?.[key]?.title ?? key]));
  const publicVerdict = release.status + (release.blockers.length
    ? ": failed required checks — " + release.blockers.map(key => titles[key]).join(", ") + "."
    : release.status === "Unverified" ? ": required evidence is missing." : ": all required checks passed in the stated scope.");
  const lines = [
    "# MCP production readiness report", "",
    "Local issue sandbox. Scripted SDK client. No model. Sequential retries.", "",
    `Launch scope: ${scope?.name ?? "local issue-management demonstration"}. Candidate configuration: ${scope?.candidateMode ?? "boundary"}.`, "",
    `**Local workflow with boundary tracing: ${ready ? "passes" : "incomplete or failed"}.**`, "",
    `**Public release: ${publicVerdict}**`, "",
    "Missing required evidence: " + (release.unverified.map(key => titles[key]).join(", ") || "none") + ".", "",
    "## Main finding", "",
    ...summary.map(group => {
      const count = group.checks.trace;
      const validation = group.checks.validation;
      return `- ${group.mode}: failed-call trace ${count.pass} pass, ${count.fail} fail, ${count.unverified} unverified; invalid-write check ${validation.pass} pass, ${validation.fail} fail, ${validation.unverified} unverified. Scheduled attempts: ${group.scheduled}.`;
    }), "",
    "A trace failure means a readable trace lacks the required call, tool, or field. A missing trace is Unverified. The trace change does not fix anonymous access.", "",
    "## All scheduled attempts", "",
    "Workflow combines create, retry, retrieval, and invalid-write state checks. Individual checks appear in the counts below and results.json.", "",
    "| Attempt evidence | Outcome | Calls | Call time (ms) | Workflow | Failed-call trace | Anonymous writes denied |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(row => `| [${row.id}](${row.id}/events.jsonl) | ${row.terminal} | ${row.calls} | ${row.observedCallDurationMs.toFixed(1)} | ${workflowLabel(row)} | ${labels(row.checks.trace)} | ${labels(row.checks.rejectsAnonymousWrite)} |`), "",
    "## Counts by configuration", "",
    "P/F/U = Pass / Fail / Unverified. Every scheduled attempt stays in the denominator.", "",
    "| Configuration | Scheduled | Complete | Errors | Timeouts | Interrupted | Incomplete |",
    "|---|---|---|---|---|---|---|",
    ...summary.map(group => `| ${group.mode} | ${group.scheduled} | ${group.complete} | ${group.executionErrors} | ${group.timeouts} | ${group.interruptions} | ${group.incomplete} |`), "",
    "| Check | " + summary.map(group => `${group.mode} P/F/U`).join(" | ") + " |",
    "|" + Array(summary.length + 1).fill("---").join("|") + "|",
    ...columns.map(key => `| ${titles[key]} | ` + summary.map(group => {
      const count = group.checks[key];
      return `${count.pass}/${count.fail}/${count.unverified}`;
    }).join(" | ") + " |"), "",
    "## Inspect the evidence", "",
    "Compare the invalid call's reply and state with the preceding retrieval snapshot. Find the same correlation ID in the attempt's trace.jsonl. Middleware-only capture misses schema validation before tool middleware runs; boundary capture records that error.", "",
    ...rows.map(row => `- ${row.id}: [journal](${row.id}/events.jsonl), [trace](${row.id}/trace.jsonl), [final store](${row.id}/state.json).`), "",
    ...rows.filter(row => row.evidenceErrors.length).map(row => `- Evidence warning for ${row.id}: ${row.evidenceErrors.join("; ")}`), "",
    "## Limits and next action", "",
    "These are local observations, not a production success rate. Call times describe these attempts, not hosted performance. Tenant isolation, model planning, concurrent retries, cross-client behavior, and hosted reliability remain unverified. Enforce identity before public release, then test allowed and denied writes with two identities.", "",
    "[Configuration and hashes](manifest.json) · [Release decision](release.json) · [Machine-readable checks](results.json) · [Counts](summary.json)",
  ];
  if (manifest.schemaVersion >= 2) {
    lines.push("", "[Exact task and rules](task.json) · [Grader used for this run](verifier.mjs)", "",
      "Regenerate offline: `node <run-directory>/verifier.mjs <run-directory>`.");
  }
  await writeFile(resolve(dir, "results.json"), JSON.stringify(rows, null, 2) + "\n");
  await writeFile(resolve(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  await writeFile(resolve(dir, "release.json"), JSON.stringify({ scope, ...release }, null, 2) + "\n");
  await writeFile(resolve(dir, "REPORT.md"), lines.join("\n") + "\n");
  console.log(`Local workflow: ${ready ? "passes" : "incomplete or failed"}. Public release: ${publicVerdict}`);
  return { rows, summary, ready, release };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/report.mjs <run-directory>");
  await report(resolve(process.argv[2]));
}
