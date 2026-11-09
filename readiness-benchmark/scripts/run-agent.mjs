import { fork } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, appendFile, readFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { buildPrompt, CHAT_SETTINGS, CHAT_URL, DEFAULT_MODEL, SYSTEM_PROMPT, runConversation } from "./agent.mjs";
import { agentReport } from "./agent-report.mjs";

export async function runAgentBenchmark({ apiKey, model = DEFAULT_MODEL, repetitions = 3 } = {}) {
  if (!apiKey) throw new Error("Set OPENAI_API_KEY to an OpenAI API key before running the model task.");
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error("Repetitions must be an integer from 1 to 10.");
  const task = JSON.parse(await readFile("benchmark/task.json", "utf8"));
  const expected = task.expected;
  const initialState = { mode: "remediated", nextIssueNumber: 1,
    projects: [{ name: "Mobile" }], users: [{ email: expected.assignee }], issues: [] };
  const limits = { maxTurns: 6, maxToolCalls: 6, apiTimeoutMs: 30_000,
    attemptTimeoutMs: 120_000, startupTimeoutMs: 10_000, mcpTimeoutMs: 5_000 };
  const attempts = Array.from({ length: repetitions }, (_, i) => `agent-${i + 1}`);
  const sources = ["index.ts", "benchmark/store.ts", "benchmark/trace.ts", "benchmark/task.json",
    "scripts/agent.mjs", "scripts/agent-report.mjs", "scripts/run-agent.mjs", "scripts/serve.mjs", "package.json", "package-lock.json"];
  const hash = data => createHash("sha256").update(data).digest("hex");
  const sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async file => [file, hash(await readFile(file))])));
  const buildSha256 = hash(await readFile(".mcp-use/build/index.js"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  await mkdir("runs", { recursive: true });
  const dir = await mkdtemp(resolve("runs", `agent-${new Date().toISOString().replaceAll(":", "-")}-`));
  const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + "\n");
  const manifest = { schemaVersion: 2, kind: "launch-readiness",
    evidenceSource: "live OpenAI API",
    releaseScope: task.releaseScope.name,
    requiredChecks: ["createdRequestedIssue", "retrievedWithoutMutation", "retry", "validation", "trace",
      "rejectsAnonymousWrite", "tenantIsolation", "crossClient", "deployment", "security"],
    createdAt: new Date().toISOString(), model, endpoint: CHAT_URL,
    settings: CHAT_SETTINGS, systemPrompt: SYSTEM_PROMPT, prompt: buildPrompt(expected),
    expected, initialState, attempts, limits, auth: "anonymous loopback MCP; API key is used only for OpenAI",
    client: { name: "@modelcontextprotocol/client", version: lock.packages["node_modules/@modelcontextprotocol/client"].version },
    serverFramework: { name: "mcp-use", version: lock.packages["node_modules/mcp-use"].version },
    harness: "readiness-agent-v2", node: process.version, sourceSha256, buildSha256,
  };
  await copyFile("scripts/agent-report.mjs", resolve(dir, "verifier.mjs"));
  await save(resolve(dir, "manifest.json"), manifest);
  console.log(`Model evidence: ${dir}`);
  let executionErrors = 0;
  for (const id of attempts) {
    const folder = resolve(dir, id);
    await mkdir(folder);
    const statePath = resolve(folder, "state.json");
    const tracePath = resolve(folder, "trace.jsonl");
    await save(statePath, initialState);
    await writeFile(tracePath, "");
    const journal = record => appendFile(resolve(folder, "events.jsonl"),
      (JSON.stringify({ time: new Date().toISOString(), ...record }).split(apiKey).join("[REDACTED]")) + "\n");
    const snapshot = async () => {
      try { return { state: JSON.parse(await readFile(statePath, "utf8")) }; }
      catch { return { state: null, stateError: "Could not read sandbox state" }; }
    };
    await journal({ event: "started", identity: "anonymous", state: initialState });
    const childEnv = { ...process.env, BENCHMARK_STATE_PATH: statePath,
      BENCHMARK_TRACE_PATH: tracePath, BENCHMARK_TRACE_MODE: "boundary" };
    delete childEnv.OPENAI_API_KEY;
    const child = fork(new URL("./serve.mjs", import.meta.url), [], { env: childEnv });
    const client = new Client({ name: "readiness-agent", version: "1" });
    try {
      const url = await new Promise((resolveUrl, reject) => {
        const timer = setTimeout(() => finish(new Error("Local MCP startup timeout")), limits.startupTimeoutMs);
        const message = value => finish(null, value);
        const exited = () => finish(new Error("Local MCP exited before connection"));
        const failed = () => finish(new Error("Could not start local MCP"));
        function finish(error, value) {
          clearTimeout(timer); child.off("message", message); child.off("exit", exited); child.off("error", failed);
          error ? reject(error) : resolveUrl(value);
        }
        child.once("message", message); child.once("exit", exited); child.once("error", failed);
      });
      const attemptSignal = AbortSignal.timeout(limits.attemptTimeoutMs);
      await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        const request = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        if (request?.method === "tools/call") {
          headers.set("x-readiness-call", request.params?._meta?.["readiness/correlation"] ?? randomUUID());
        }
        return fetch(url, { ...init, headers, signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []), attemptSignal, AbortSignal.timeout(limits.mcpTimeoutMs),
        ]) });
      } }), { timeout: limits.mcpTimeoutMs });
      if (client.getServerVersion()?.name !== "manufact-production-readiness-benchmark") throw new Error("Unexpected local MCP server");
      const { tools } = await client.listTools(undefined, { timeout: limits.mcpTimeoutMs });
      await journal({ event: "connected", server: client.getServerVersion(), tools });
      // Stored per attempt because tool discovery is part of the evidence.
      await save(resolve(folder, "tools.json"), tools);
      const modelFinished = await runConversation({ client, tools, expected, model, apiKey, journal, snapshot,
        signal: attemptSignal, maxTurns: limits.maxTurns, maxToolCalls: limits.maxToolCalls });
      async function probe(step, args) {
        attemptSignal.throwIfAborted();
        const before = await snapshot();
        const correlation = randomUUID();
        await journal({ event: "probe_call", step, name: "create-issue", args, correlation });
        const response = await client.callTool({ name: "create-issue", arguments: args,
          _meta: { "readiness/correlation": correlation } }, { timeout: limits.mcpTimeoutMs });
        await journal({ event: "probe_reply", step, name: "create-issue", args, correlation,
          response, beforeState: before.state, ...await snapshot() });
      }
      await probe("retry", expected);
      await probe("invalid", { ...expected, ...task.invalidOverrides });
      await probe("anonymous", { ...expected, externalId: "PROBE-ANONYMOUS" });
      let records = null;
      try { records = (await readFile(tracePath, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)); }
      catch { /* Missing or unreadable trace remains Unverified. */ }
      await journal({ event: "probe_trace", records });
      await journal({ event: modelFinished ? "complete" : "budget_exceeded", ...await snapshot() });
    } catch (error) {
      executionErrors++;
      await journal({ event: /timeout|timed out/i.test(`${error.name} ${error.message}`) ? "timeout" : "execution_error",
        error: String(error).split(apiKey).join("[REDACTED]"), ...await snapshot() });
    } finally {
      await client.close().catch(() => {});
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        if (child.connected) child.disconnect();
        const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
        await exited;
        clearTimeout(timer);
      }
    }
  }
  const result = await agentReport(dir);
  return { dir, executionErrors, ...result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    let localEnv = {};
    try { localEnv = parseEnv(await readFile(".env", "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw new Error("Could not read the project's .env file"); }
    const { values } = parseArgs({ options: {
      model: { type: "string", default: localEnv.OPENAI_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL },
      repetitions: { type: "string", default: "3" },
    } });
    const result = await runAgentBenchmark({ apiKey: localEnv.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
      model: values.model, repetitions: Number(values.repetitions) });
    if (result.executionErrors || result.rows.some(row => row.terminal !== "complete")) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
