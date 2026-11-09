import { fork } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, appendFile, readFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { report } from "./report.mjs";

const { values } = parseArgs({ options: {
  repetitions: { type: "string", default: "3" },
  "interrupt-after-create": { type: "boolean", default: false },
} });
const repetitions = Number(values.repetitions);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) {
  throw new Error("--repetitions must be an integer from 1 to 100");
}
const startupTimeoutMs = 10_000;
const requestTimeoutMs = 5_000;
const task = JSON.parse(await readFile("benchmark/task.json", "utf8"));
const expected = task.expected;
const seed = {
  mode: "remediated", nextIssueNumber: 1, projects: [{ name: "Mobile" }],
  users: [{ email: expected.assignee }], issues: [],
};
const hash = data => createHash("sha256").update(data).digest("hex");
const save = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + "\n");
const sourceFiles = ["index.ts", "benchmark/store.ts", "benchmark/trace.ts", "benchmark/task.json",
  "scripts/run-benchmark.mjs", "scripts/report.mjs", "scripts/serve.mjs", "package.json", "package-lock.json"];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await readFile(file))])));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const configurations = Array.from({ length: repetitions }, (_, i) => [
  { mode: "middleware", id: `middleware-${i + 1}` },
  { mode: "boundary", id: `boundary-${i + 1}` },
]).flat();
await mkdir("runs", { recursive: true });
const dir = await mkdtemp(resolve("runs", new Date().toISOString().replaceAll(":", "-") + "-"));
await copyFile("scripts/report.mjs", resolve(dir, "verifier.mjs"));
await copyFile("benchmark/task.json", resolve(dir, "task.json"));
await save(resolve(dir, "manifest.json"), {
  schemaVersion: 2, createdAt: new Date().toISOString(), task, expected, initialState: seed,
  configurations, repetitions, order: "alternating middleware then boundary",
  model: null, auth: "anonymous loopback; public-release policy requires identity",
  client: { name: "@modelcontextprotocol/client", version: lock.packages["node_modules/@modelcontextprotocol/client"].version },
  serverFramework: { name: "mcp-use", version: lock.packages["node_modules/mcp-use"].version },
  harness: { name: "readiness-harness", version: "3" }, node: process.version,
  startupTimeoutMs, requestTimeoutMs, simulatedInterruption: values["interrupt-after-create"],
  buildSha256: hash(await readFile(".mcp-use/build/index.js")), sourceSha256,
});
console.log(`Evidence: ${dir}`);

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Startup timeout"), { name: "TimeoutError" })), ms);
    })]);
  } finally { clearTimeout(timer); }
}

for (const { id, mode } of configurations) {
  const folder = resolve(dir, id);
  await mkdir(folder);
  const state = resolve(folder, "state.json");
  const trace = resolve(folder, "trace.jsonl");
  await save(state, seed);
  const journal = data => appendFile(resolve(folder, "events.jsonl"),
    JSON.stringify({ time: new Date().toISOString(), ...data }) + "\n");
  async function snapshot() {
    try { return { state: JSON.parse(await readFile(state, "utf8")) }; }
    catch (error) { return { state: null, stateError: String(error) }; }
  }
  await journal({ event: "started", state: seed, identity: "anonymous" });
  const child = fork(new URL("./serve.mjs", import.meta.url), [], { env: { ...process.env,
    BENCHMARK_STATE_PATH: state, BENCHMARK_TRACE_PATH: trace, BENCHMARK_TRACE_MODE: mode } });
  let correlation;
  const client = new Client({ name: "readiness-harness", version: "3" });
  try {
    const [url] = await withTimeout(Promise.race([
      once(child, "message"),
      once(child, "exit").then(() => { throw new Error("Server exited before connection"); }),
    ]), startupTimeoutMs);
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      if (correlation) headers.set("x-readiness-call", correlation);
      return fetch(url, { ...init, headers, signal: AbortSignal.any([
        ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(requestTimeoutMs),
      ]) });
    } }), { timeout: requestTimeoutMs });
    const server = client.getServerVersion();
    if (server?.name !== "manufact-production-readiness-benchmark") throw new Error("Unexpected server");
    await journal({ event: "connected", server,
      tools: (await client.listTools(undefined, { timeout: requestTimeoutMs })).tools });
    async function call(step, name, args) {
      correlation = randomUUID();
      await journal({ event: "call", step, name, args, correlation });
      const start = performance.now();
      const response = await client.callTool({ name, arguments: args }, { timeout: requestTimeoutMs });
      await journal({ event: "reply", step, correlation, response,
        durationMs: performance.now() - start, ...await snapshot() });
      return response.structuredContent;
    }
    const first = await call("create", "create-issue", expected);
    if (values["interrupt-after-create"]) {
      throw Object.assign(new Error("Simulated harness interruption after the committed create"), { name: "InterruptionError" });
    }
    await call("retry", "create-issue", expected);
    await call("retrieve", "get-issue", { id: first?.issue?.id ?? "MISSING-CREATE-RESULT" });
    await call("invalid", "create-issue", { ...expected, ...task.invalidOverrides });
    await journal({ event: "complete" });
  } catch (error) {
    const event = error.name === "InterruptionError" ? "interrupted"
      : /timeout|timed out/i.test(`${error.name} ${error.message}`) ? "timeout" : "execution_error";
    await journal({ event, correlation, error: String(error), ...await snapshot() });
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      if (child.connected) child.disconnect();
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      await exited;
      clearTimeout(killTimer);
    }
  }
}
await report(dir);
