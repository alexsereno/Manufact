import { randomBytes, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual as equal } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { grade } from "./scorecard.mjs";

const phase = process.argv[2];
const output = resolve("runs/auth-demo");
async function showRubric(record) {
  const profileName = phase === "after" ? "after" : "before";
  const profile = JSON.parse(await readFile(`benchmark/profiles/${profileName}.json`, "utf8"));
  const report = grade(profile, [record]);
  console.log("\nMANUFACT RELEASE RUBRIC   |   Local issue server · MCP SDK over HTTP");
  for (const row of report.rows) {
    const status = record ? row.status.toUpperCase() : "PENDING";
    console.log(`  ${status.padEnd(10)} ${row.label}${row.answer ? "  — " + row.answer : ""}`);
  }
  const passed = report.rows.filter(row => row.status === "Pass").length;
  const result = !record ? "AWAITING TEST" : report.verdict === "Ready" ? "ALL CHECKS PASSED" : report.verdict.toUpperCase();
  console.log(`  ${passed}/${report.rows.length} passed  ·  ${result}\n`);
  return report;
}

if (phase === "reset") {
  for (const name of ["before.json", "after.json"]) await rm(join(output, name), { force: true });
  console.log("Ready for a new take. Each scene starts with one public issue, MOB-1.");
  await showRubric(null);
  process.exit(0);
}
if (!["before", "after"].includes(phase)) throw new Error("Choose reset, before or after.");

const scratch = await mkdtemp(join(tmpdir(), "manufact-auth-demo-"));
const stateFile = join(scratch, "state.json");
const traceFile = join(scratch, "trace.jsonl");
const writerToken = randomBytes(32).toString("hex");
process.env.BENCHMARK_FILMING = "1";
process.env.BENCHMARK_STATE_PATH = stateFile;
process.env.BENCHMARK_TRACE_PATH = traceFile;
process.env.BENCHMARK_WRITE_AUTH = phase === "after" ? "required" : "off";
process.env.BENCHMARK_WRITER_TOKEN = writerToken;
const clients = [];
let server;
let pending;
try {
  const build = new URL("../.mcp-use/build/index.js", import.meta.url);
  ({ default: server } = await import(build.href));
  const { expected: fields } = JSON.parse(await readFile("benchmark/task.json", "utf8"));
  const seed = { ...fields, id: "MOB-1", externalId: "PUBLIC-1", title: "Improve the public roadmap",
    description: "Track the next public roadmap update.", createdAt: "2026-01-01T00:00:00.000Z" };
  const initial = { mode: "remediated", projects: [{ name: "Mobile" }], users: [{ email: fields.assignee }],
    nextIssueNumber: 2, issues: [seed] };
  await writeFile(stateFile, JSON.stringify(initial));
  if (phase === "after") console.log("Applying fix: require a writer credential on create-issue. Rerunning the release rubric…");
  const { url } = await server.listen(0, { host: "127.0.0.1" });
  async function connect(identity, token) {
    const client = new Client({ name: identity, version: "1" });
    clients.push(client);
    const requestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit }));
    return client;
  }
  const anonymous = await connect("anonymous");
  const writer = await connect("test-writer", writerToken);
  const discovery = await anonymous.listTools();
  const operatingTargetMs = 2000;
  const events = [];
  const snapshot = async () => JSON.parse(await readFile(stateFile, "utf8"));
  async function call(client, name, args) {
    const before = await snapshot();
    const start = performance.now();
    const reply = await client.callTool({ name, arguments: args });
    const durationMs = performance.now() - start;
    const after = await snapshot();
    const event = { identity: client === anonymous ? "anonymous" : "test-writer", name, args, reply, durationMs, before, after };
    events.push(event);
    return event;
  }
  const read = await call(anonymous, "get-issue", { id: seed.id });
  const anonWrite = await call(anonymous, "create-issue", { ...fields, externalId: "DEMO-ANONYMOUS" });
  const signedWrite = await call(writer, "create-issue", { ...fields, externalId: "DEMO-WRITER" });
  function created(event) {
    const issue = event.reply.structuredContent?.issue;
    return !event.reply.isError && event.reply.structuredContent?.created === true &&
      issue && Object.entries(event.args).every(([k, value]) => issue[k] === value) &&
      equal(event.after.issues, [...event.before.issues, issue]);
  }
  const denied = anonWrite.reply.isError === true && anonWrite.reply.content.some(
    item => item.type === "text" && item.text === "Sign in to create an issue."
  ) && equal(anonWrite.before, anonWrite.after);
  const checks = {
    publicRead: !read.reply.isError && equal(read.reply.structuredContent?.issue, seed) && equal(read.before, read.after),
    writerCreated: Boolean(created(signedWrite)),
    anonymousDenied: denied ? true : created(anonWrite) ? false : null,
  };
  const retrieval = await call(writer, "get-issue", { id: signedWrite.reply.structuredContent?.issue?.id ?? "MOB-UNKNOWN" });
  const retry = await call(writer, "create-issue", signedWrite.args);
  const missing = await call(anonymous, "get-issue", { id: "MOB-MISSING" });
  const trace = (await readFile(traceFile, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  Object.assign(checks, {
    discovery: ["create-issue", "get-issue"].every(name => discovery.tools.some(tool => tool.name === name && tool.inputSchema?.type === "object")),
    outcome: checks.writerCreated && equal(retrieval.reply.structuredContent?.issue, signedWrite.after.issues.at(-1)) && !retrieval.reply.isError,
    recovery: retry.reply.structuredContent?.deduplicated === true && equal(retry.before, retry.after) &&
      missing.reply.isError === true && missing.reply.content.some(item => item.text?.includes("was not found")) && equal(missing.before, missing.after),
    compatibility: Boolean(anonymous.getServerVersion() && writer.getServerVersion()) && checks.publicRead && checks.writerCreated,
    operations: trace.some(entry => entry.tool === "get-issue" && entry.arguments?.id === "MOB-MISSING" && entry.outcome === "tool_error") &&
      events.every(event => event.durationMs <= operatingTargetMs),
  });
  const record = { phase, buildSha256: createHash("sha256").update(await readFile(build)).digest("hex"),
    writeAuthentication: process.env.BENCHMARK_WRITE_AUTH, checks, events, trace, discovery, operatingTargetMs };
  await mkdir(output, { recursive: true });
  pending = join(output, phase + "-" + randomBytes(8).toString("hex") + ".tmp");
  await writeFile(pending, JSON.stringify(record, null, 2) + "\n");
  await rename(pending, join(output, phase + ".json"));
  console.log(`\n${phase === "before" ? "BEFORE" : "AFTER"} THE FIX   |   Public issues · signed-in writers\n`);
  console.log(`  Anonymous read     ${read.reply.structuredContent?.issue?.title ?? "No issue returned"}`);
  for (const [label, event] of [["Anonymous write", anonWrite], ["Writer's write", signedWrite]]) {
    console.log(`  ${label.padEnd(18)} ${event.reply.content[0]?.text}   (${event.before.issues.length} → ${event.after.issues.length} issues)`);
  }
  console.log(`  Evidence: runs/auth-demo/${phase}.json`);
  const report = await showRubric(record);
  const otherChecksPassed = report.rows.every(row => row.id === "authentication" || row.status === "Pass");
  if (!otherChecksPassed || !checks.publicRead || !checks.writerCreated || checks.anonymousDenied !== (phase === "after")) {
    throw new Error("Observed behavior differs from the filming scenario. Inspect the evidence above.");
  }
} finally {
  await Promise.allSettled(clients.map(client => client.close()));
  await server?.close();
  await rm(scratch, { recursive: true, force: true });
  if (pending) await rm(pending, { force: true });
}
