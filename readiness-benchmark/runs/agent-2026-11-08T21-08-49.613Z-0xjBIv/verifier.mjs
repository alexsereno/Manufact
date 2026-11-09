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

export async function agentReport(dir) {
  const manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8"));
  const rows = [];
  for (const id of manifest.attempts) {
    const { events, error } = await readJournal(resolve(dir, id, "events.jsonl"));
    const checks = gradeAgent(events, manifest.expected);
    const terminal = events.at(-1)?.event ?? "not_started";
    const evidenceErrors = [error, ...events.filter(e => e.stateError).map(e => e.stateError)].filter(Boolean);
    const verdict = Object.values(checks).some(value => value === false) ? "Fail"
      : terminal === "complete" && !evidenceErrors.length && Object.values(checks).every(value => value === true)
        ? "Pass" : "Unverified";
    const modelReplies = events.filter(e => e.event === "model_reply");
    rows.push({ id, terminal, verdict, checks, evidenceErrors,
      toolCalls: events.filter(e => e.event === "call").length,
      modelRequests: events.filter(e => e.event === "model_request").length,
      returnedModels: [...new Set(modelReplies.map(e => e.completion.model).filter(Boolean))],
      tokenUsage: modelReplies.reduce((sum, e) => ({
        prompt: sum.prompt + (e.completion.usage?.prompt_tokens ?? 0),
        completion: sum.completion + (e.completion.usage?.completion_tokens ?? 0),
      }), { prompt: 0, completion: 0 }),
    });
  }
  const summary = { scheduled: rows.length,
    pass: rows.filter(row => row.verdict === "Pass").length,
    fail: rows.filter(row => row.verdict === "Fail").length,
    unverified: rows.filter(row => row.verdict === "Unverified").length };
  const labels = value => value === null ? "Unverified" : value ? "Pass" : "Fail";
  const lines = ["# Model-driven MCP task report", "",
    `Evidence source: **${manifest.evidenceSource}**. Requested model: **${manifest.model}**. API: OpenAI Chat Completions.`, "",
    `**Task result: ${summary.pass}/${summary.scheduled} Pass, ${summary.fail} Fail, ${summary.unverified} Unverified.**`, "",
    "**Launch readiness is not established by this task.** The separate scripted checks still determine authentication, retry, validation, and release findings.", "",
    "## Task", "", manifest.prompt, "",
    "The model chooses calls from tools discovered over MCP. Code checks the saved issue and a successful retrieval without state changes. Final assistant text is not a grading input.", "",
    "## Every scheduled attempt", "",
    "| Evidence | Execution | Task | Create correct issue | Retrieve without mutation | Model requests | MCP calls | Prompt / completion tokens |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(row => `| [${row.id}](${row.id}/events.jsonl) | ${row.terminal} | ${row.verdict} | ${labels(row.checks.createdRequestedIssue)} | ${labels(row.checks.retrievedWithoutMutation)} | ${row.modelRequests} | ${row.toolCalls} | ${row.tokenUsage.prompt} / ${row.tokenUsage.completion} |`), "",
    ...rows.map(row => `- ${row.id}: [saved data](${row.id}/state.json), [server log](${row.id}/trace.jsonl). Returned model: ${row.returnedModels.join(", ") || "no response"}.`),
    ...rows.filter(row => row.evidenceErrors.length).map(row => `- ${row.id}: ${row.evidenceErrors.join(" ")}`), "",
    "## Limits", "",
    "One task, one model, one client, synthetic local data, anonymous MCP access. These counts describe only the scheduled attempts. They do not establish general model quality, server security, marketplace acceptance, or a production success rate. Model/API errors and incomplete evidence remain visible. No automatic API retries or model substitutions occur.", "",
    "The manifest records the exact prompts, model settings, limits, versions, and source/build hashes. Each attempt records discovered tools. The journal retains request bodies, model replies, tool calls, and direct state snapshots. Authorization headers and API keys are not saved.", "",
    "[Configuration](manifest.json) · [Checks](results.json) · [Counts](summary.json) · [Saved grader](verifier.mjs)", "",
    "Regrade offline: `node <run-directory>/verifier.mjs <run-directory>`.", "",
  ];
  await writeFile(resolve(dir, "REPORT.md"), lines.join("\n"));
  await writeFile(resolve(dir, "results.json"), JSON.stringify(rows, null, 2) + "\n");
  await writeFile(resolve(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`Model task: ${summary.pass}/${summary.scheduled} Pass, ${summary.fail} Fail, ${summary.unverified} Unverified. Evidence: ${dir}`);
  return { rows, summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/agent-report.mjs <run-directory>");
  await agentReport(resolve(process.argv[2]));
}
