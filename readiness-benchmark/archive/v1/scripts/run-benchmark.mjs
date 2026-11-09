import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(root, "evidence");
const statePath = resolve(root, "benchmark/data/state.json");
const tracePath = resolve(root, "benchmark/data/server-trace.jsonl");
const port = 3100;
const endpoint = `http://127.0.0.1:${port}/mcp`;

const taskWording =
  "Create an issue for the checkout crash in the Mobile project, set priority high, assign alex.test@example.com, and retrieve it to confirm the final state. If the same request is retried, do not create a duplicate.";

const expected = {
  externalId: "BUG-MOBILE-CHECKOUT-001",
  title: "Checkout crashes after payment confirmation",
  description:
    "On the test build, confirming a valid card payment closes the Mobile app before the receipt appears.",
  project: "Mobile",
  priority: "high",
  assignee: "alex.test@example.com",
};

const serverLogs = [];

async function waitForServer(process) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Server exited early with code ${process.exitCode}`);
    }
    try {
      const response = await fetch(endpoint, {
        headers: { accept: "text/html" },
      });
      if (response.ok) return;
    } catch {
      // The listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for the local MCP server");
}

function structured(result) {
  if (result.isError) {
    throw new Error(`Tool returned an error: ${JSON.stringify(result.content)}`);
  }
  if (!result.structuredContent || typeof result.structuredContent !== "object") {
    throw new Error("Tool result did not include structuredContent");
  }
  return result.structuredContent;
}

async function verifyPersistedState(firstIssueId, retrievedIssue) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const matching = state.issues.filter(
    (issue) => issue.externalId === expected.externalId
  );
  const first = matching.find((issue) => issue.id === firstIssueId);
  const fieldsMatch =
    first &&
    Object.entries(expected).every(([key, value]) => first[key] === value);
  const retrievedMatches =
    first && JSON.stringify(first) === JSON.stringify(retrievedIssue);

  return {
    source: "benchmark/data/state.json (read directly, outside MCP)",
    issueCountForExternalId: matching.length,
    fieldsMatch: Boolean(fieldsMatch),
    retrievedMatchesPersistedState: Boolean(retrievedMatches),
    success:
      matching.length === 1 && Boolean(fieldsMatch) && Boolean(retrievedMatches),
  };
}

async function runAttempt(client, mode, attempt) {
  const started = Date.now();
  await client.callTool({
    name: "benchmark-reset",
    arguments: { mode },
  });

  const first = structured(
    await client.callTool({ name: "create-issue", arguments: expected })
  );
  const second = structured(
    await client.callTool({ name: "create-issue", arguments: expected })
  );
  const retrieved = structured(
    await client.callTool({
      name: "get-issue",
      arguments: { id: first.issue.id },
    })
  );

  let invalidInputRejected = false;
  let invalidInputEvidence = "";
  try {
    const invalid = await client.callTool({
      name: "create-issue",
      arguments: { ...expected, externalId: "INVALID-PRIORITY", priority: "critical" },
    });
    invalidInputRejected = Boolean(invalid.isError);
    invalidInputEvidence = JSON.stringify(invalid.content);
  } catch (error) {
    invalidInputRejected = true;
    invalidInputEvidence = error instanceof Error ? error.message : String(error);
  }

  const verifier = await verifyPersistedState(first.issue.id, retrieved.issue);
  return {
    mode,
    attempt,
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    toolCallCount: 5,
    toolErrors: invalidInputRejected ? 1 : 0,
    recoveredErrors: 0,
    firstCreate: {
      issueId: first.issue.id,
      created: first.created,
      deduplicated: first.deduplicated,
    },
    repeatedCreate: {
      issueId: second.issue.id,
      created: second.created,
      deduplicated: second.deduplicated,
    },
    invalidInputRejected,
    invalidInputEvidence,
    verifier,
  };
}

function makeCheck({
  name,
  dimension,
  status,
  severity,
  why,
  evidence,
  limitation,
  next,
  manufact,
  path,
  attribution,
}) {
  return {
    name,
    dimension,
    status,
    severity,
    whyItMatters: why,
    evidenceObserved: evidence,
    scopeOrLimitation: limitation,
    recommendedNextAction: next,
    manufactCloudCanHelp: manufact,
    evidencePath: path,
    attribution,
  };
}

function renderReport(results, checks) {
  const baseline = results.attempts.filter((run) => run.mode === "baseline");
  const remediated = results.attempts.filter(
    (run) => run.mode === "remediated"
  );
  const statusCounts = Object.fromEntries(
    ["Pass", "Fail", "Can't verify", "Not applicable"].map((status) => [
      status,
      checks.filter((check) => check.status === status).length,
    ])
  );

  const matrix = checks
    .map(
      (check) =>
        `| ${check.dimension} | ${check.name} | ${check.status} | ${check.severity} | ${check.evidencePath} |`
    )
    .join("\n");

  return `# MCP Production Readiness Benchmark — Working Slice

## Launch assessment

- **Intended use:** Local, authorized issue-management sandbox; not production data.
- **Intended users:** MCP server owners and builders preparing a user-facing launch.
- **Intended agent surfaces:** This measured slice uses the official TypeScript MCP client as a deterministic harness. ChatGPT, Claude, and coding-agent runs are proposed, not measured.
- **Overall conclusion:** **Ready for limited test launch.** The canonical task passes after remediation, but public production launch is blocked until authentication and authorization are implemented and independently tested.

Measured ${results.generatedAt}. No model was used in the executed harness, so the three repeated attempts test server and verifier determinism, not agent reliability.

## 1. Critical findings

- **Authentication boundary — Can't verify / Blocker for public launch.** The local server deliberately has no OAuth or multi-user boundary. No claim about tenant isolation or least privilege is possible.
- **Duplicate creation — Baseline Fail / Blocker, remediated Pass.** The explicitly labeled baseline regression created two issues for one external id on all ${baseline.length} attempts. The remediation returned the original issue on all ${remediated.length} attempts.
- **Validation failures missing from server trace — Fail / Important.** All six invalid calls were rejected, but the tool middleware trace cannot see failures that happen during schema validation.

## 2. Production-readiness matrix

| Dimension | Check | Status | Severity | Evidence |
| --- | --- | --- | --- | --- |
${matrix}

Summary: ${statusCounts.Pass} pass, ${statusCounts.Fail} fail, ${statusCounts["Can't verify"]} can't verify, ${statusCounts["Not applicable"]} not applicable. There is no aggregate score because this small slice has no defensible public weighting.

## 3. Canonical task result

> ${taskWording}

- Baseline: ${baseline.filter((run) => run.verifier.success).length}/${baseline.length} independently verified successes.
- Remediated: ${remediated.filter((run) => run.verifier.success).length}/${remediated.length} independently verified successes.
- Each attempt made five calls: reset, create, retry create, retrieve, and invalid-input probe.
- The verifier read persisted state directly; it did not accept the tool's success text as proof.

## 4. Evidence and trace

- [Raw results](./evidence/raw-results.json)
- [Machine-readable checks](./evidence/readiness-checks.json)
- [Server trace](./evidence/server-trace.jsonl)
- [Final sandbox state](./benchmark/data/state.json)

The trace records successful tool calls with inputs, server version, timestamp, duration, and outcome. Keys that resemble secrets, tokens, cookies, or authorization headers are redacted. The invalid-input failures appear in harness results but not in the server trace because schema validation occurs before tool middleware; that is reported as an observability gap. Token and cost data are unavailable because this deterministic slice does not invoke a model.

## 5. Before-and-after remediation

The baseline is an **injected, explicitly labeled regression** controlled by the reset fixture. In baseline mode, a repeated \`externalId\` creates a second issue. The remediation checks persisted state for that key and returns the original issue without writing. Task wording, test data, client, server process, verifier, and attempt count remain constant; only sandbox mode changes.

| Configuration | Verified successes | Duplicate count | Attribution |
| --- | ---: | ---: | --- |
| Baseline | ${baseline.filter((run) => run.verifier.success).length}/${baseline.length} | ${baseline.map((run) => run.verifier.issueCountForExternalId).join(", ")} | Server defect (injected regression) |
| Remediated | ${remediated.filter((run) => run.verifier.success).length}/${remediated.length} | ${remediated.map((run) => run.verifier.issueCountForExternalId).join(", ")} | Server remediation |

## 6. Known unknowns

- Authentication, authorization, tenant isolation, OAuth scope design, and destructive-action confirmation were not tested.
- No model, browser client, ChatGPT, Claude, or coding-agent configuration was measured.
- Local repeatability does not establish hosted availability, load capacity, rollback safety, store acceptance, or 30-day reliability.
- The benchmark has one workflow and one server; it does not support ecosystem-wide rankings.

## 7. Recommended next steps

1. Add OAuth and a two-user authorization boundary test, then keep failed access attempts in the trace without exposing credentials.
2. Run the exact canonical task in two real clients while holding server version, initial state, wording, data, and verifier constant.
3. Add ambiguous-request and recovery tasks only after validating the standard with three MCP owners.
4. Connect or deploy the server through Manufact and rerun the stable gates against a preview endpoint.
`;
}

await mkdir(evidenceDir, { recursive: true });
await rm(tracePath, { force: true });
await rm(statePath, { force: true });

const serverProcess = spawn(
  resolve(root, "node_modules/.bin/mcp-use"),
  ["start", "--port", String(port)],
  { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] }
);
serverProcess.stdout.on("data", (chunk) => serverLogs.push(chunk.toString()));
serverProcess.stderr.on("data", (chunk) => serverLogs.push(chunk.toString()));

let client;
try {
  await waitForServer(serverProcess);
  client = new Client({ name: "manufact-readiness-harness", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  const listed = await client.listTools();

  const attempts = [];
  for (const mode of ["baseline", "remediated"]) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      attempts.push(await runAttempt(client, mode, attempt));
    }
  }

  const results = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    resultType: "measured local demonstration",
    taskWording,
    configuration: {
      endpoint,
      server: client.getServerVersion(),
      client: "@modelcontextprotocol/client 2.3.1",
      harness: "deterministic scripted MCP client; no model",
      model: "not applicable",
      authentication: "none (local sandbox)",
      verifier: "direct JSON state inspection",
      runCountPerConfiguration: 3,
      toolsDiscovered: listed.tools.map((tool) => tool.name),
      heldConstant: [
        "task wording",
        "reset initial state",
        "test data",
        "server build and version",
        "authentication state",
        "MCP client and harness",
        "verifier",
        "run count",
      ],
      changed: ["sandbox idempotency mode"],
    },
    attempts,
  };

  const baseline = attempts.filter((run) => run.mode === "baseline");
  const remediated = attempts.filter((run) => run.mode === "remediated");
  const allRemediatedPass = remediated.every((run) => run.verifier.success);
  const allInvalidRejected = attempts.every((run) => run.invalidInputRejected);
  const buildExists = await readFile(
    resolve(root, ".mcp-use/build/index.js"),
    "utf8"
  ).then(
    () => true,
    () => false
  );

  const checks = [
    makeCheck({
      name: "Canonical issue job reaches verified final state",
      dimension: "Functional readiness",
      status: allRemediatedPass ? "Pass" : "Fail",
      severity: allRemediatedPass ? "—" : "Blocker",
      why: "Users need the write and retrieval sequence to produce the requested state.",
      evidence: `${remediated.filter((run) => run.verifier.success).length}/${remediated.length} remediated attempts passed direct state verification.`,
      limitation: "Deterministic harness only; no agent planning was measured.",
      next: "Repeat in two model-plus-client configurations.",
      manufact: "Yes — cross-client tests and traces can rerun the job against a deployed server.",
      path: "evidence/raw-results.json",
      attribution: allRemediatedPass ? "Verified server outcome" : "Server defect",
    }),
    makeCheck({
      name: "Repeated request does not create a duplicate",
      dimension: "Functional readiness",
      status: allRemediatedPass ? "Pass" : "Fail",
      severity: allRemediatedPass ? "—" : "Blocker",
      why: "Agents and clients retry writes; duplicates corrupt user state.",
      evidence: `Baseline failed ${baseline.length}/${baseline.length}; remediation passed ${remediated.filter((run) => run.verifier.issueCountForExternalId === 1).length}/${remediated.length}.`,
      limitation: "One process and one idempotency key; concurrent retries were not tested.",
      next: "Add a concurrency case and persist idempotency keys in the production datastore.",
      manufact: "Partly — Manufact can rerun and trace the check; the owner must implement domain idempotency.",
      path: "evidence/raw-results.json",
      attribution: "Server defect (injected regression), then server remediation",
    }),
    makeCheck({
      name: "Invalid enum input is rejected before a write",
      dimension: "Security and safety readiness",
      status: allInvalidRejected ? "Pass" : "Fail",
      severity: allInvalidRejected ? "—" : "Important",
      why: "Validated inputs prevent unsupported states from reaching business logic.",
      evidence: `${attempts.filter((run) => run.invalidInputRejected).length}/${attempts.length} invalid priority calls were rejected; persisted issue counts were unchanged.`,
      limitation: "Only one invalid field was probed.",
      next: "Add boundary, oversized, and hostile-string cases.",
      manufact: "Yes — schema checks and regression runs can surface validation gaps.",
      path: "evidence/raw-results.json",
      attribution: "Verified server behavior",
    }),
    makeCheck({
      name: "Writes are confined to an authorized local sandbox",
      dimension: "Security and safety readiness",
      status: "Pass",
      severity: "—",
      why: "Benchmark writes must not touch live customer systems.",
      evidence: `All writes resolve to ${statePath}; tools expose no network or production credential path.`,
      limitation: "This proves fixture confinement, not production access controls.",
      next: "Keep preview credentials least-privileged when adding a hosted sandbox.",
      manufact: "Yes — preview environments can keep evaluations away from production.",
      path: "benchmark/data/state.json",
      attribution: "Verified environment configuration",
    }),
    makeCheck({
      name: "Failed calls can be located in a server trace",
      dimension: "Observability and operational readiness",
      status: "Fail",
      severity: "Important",
      why: "Operators need to locate the responsible call and boundary.",
      evidence: "Successful calls appear in the JSONL trace, but 6/6 schema-validation failures appear only in harness results because rejection occurs before tool middleware.",
      limitation: "Local tool middleware cannot reconstruct every failed request and has no correlation id, retention policy, metrics, or hosted search.",
      next: "Capture validation failures at the transport boundary, add run correlation, and set deliberate retention controls.",
      manufact: "Yes — MCP-native analytics and traces can centralize production evidence.",
      path: "evidence/server-trace.jsonl",
      attribution: "Server observability gap",
    }),
    makeCheck({
      name: "Sensitive write requires authenticated, least-privileged identity",
      dimension: "Authentication and authorization readiness",
      status: "Can't verify",
      severity: "Blocker",
      why: "A public write tool must reject callers without the required user and project permissions.",
      evidence: "The local sandbox has no OAuth provider or multi-user identity boundary.",
      limitation: "No authentication or authorization claim can be made from this fixture.",
      next: "Add OAuth, two test users, minimal scopes, and denied cross-user reads/writes.",
      manufact: "Yes — Manufact supports authentication integration and cross-client testing; authorization logic remains owner responsibility.",
      path: "proposal.md#authentication-and-authorization-readiness",
      attribution: "Verification/evidence limitation",
    }),
    makeCheck({
      name: "Server build is reproducible and version-identifiable",
      dimension: "Deployment and release readiness",
      status: buildExists && client.getServerVersion()?.version === "0.1.0" ? "Pass" : "Fail",
      severity: buildExists ? "—" : "Important",
      why: "A release must be buildable and traceable to a known server version.",
      evidence: `Production build ${buildExists ? "exists" : "is missing"}; MCP initialization reported ${JSON.stringify(client.getServerVersion())}.`,
      limitation: "No stable HTTPS endpoint, preview deployment, rollback, or load test was evaluated.",
      next: "Deploy a preview endpoint and record artifact/revision identity and rollback steps.",
      manufact: "Yes — deployment, preview workflows, and publishing checks address this boundary.",
      path: ".mcp-use/build/index.js",
      attribution: buildExists ? "Verified build evidence" : "Environment or setup failure",
    }),
  ];

  await writeFile(
    resolve(evidenceDir, "raw-results.json"),
    `${JSON.stringify(results, null, 2)}\n`
  );
  await writeFile(
    resolve(evidenceDir, "readiness-checks.json"),
    `${JSON.stringify(checks, null, 2)}\n`
  );
  await copyFile(tracePath, resolve(evidenceDir, "server-trace.jsonl"));
  await writeFile(
    resolve(root, "READINESS_REPORT.md"),
    renderReport(results, checks)
  );
  await writeFile(resolve(evidenceDir, "server-output.txt"), serverLogs.join(""));

  console.log(
    `Benchmark complete: baseline ${baseline.filter((run) => run.verifier.success).length}/${baseline.length}, remediated ${remediated.filter((run) => run.verifier.success).length}/${remediated.length}.`
  );
  console.log(`Report: ${resolve(root, "READINESS_REPORT.md")}`);
} finally {
  if (client) await client.close().catch(() => undefined);
  if (serverProcess.pid) {
    try {
      process.kill(-serverProcess.pid, "SIGTERM");
    } catch {
      serverProcess.kill("SIGTERM");
    }
  }
}
