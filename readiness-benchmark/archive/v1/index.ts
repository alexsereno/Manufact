import { MCPServer } from "mcp-use";
import { z } from "zod";

import { appendTrace } from "./benchmark/trace.js";
import {
  createIssue,
  getIssue,
  resetSandbox,
  type BenchmarkMode,
} from "./benchmark/store.js";

const SERVER_VERSION = "0.1.0";

const server = new MCPServer({
  name: "manufact-production-readiness-benchmark",
  title: "MCP Production Readiness Benchmark",
  version: SERVER_VERSION,
  description:
    "A local issue-management sandbox for demonstrating verified MCP production-readiness checks.",
  instructions:
    "For the canonical benchmark job, call create-issue with every requested field, then call get-issue and compare the returned issue with the request. The benchmark harness independently verifies persisted state.",
  websiteUrl: "https://manufact.com",
  icons: [
    {
      src: "icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["512x512"],
    },
  ],
});

server.use("mcp:tools/call", async (ctx, next) => {
  const startedAt = Date.now();
  try {
    const result = await next();
    await appendTrace({
      timestamp: new Date().toISOString(),
      serverVersion: SERVER_VERSION,
      method: ctx.method,
      tool: ctx.params.name,
      arguments: ctx.params.arguments ?? {},
      durationMs: Date.now() - startedAt,
      outcome: result.isError ? "tool_error" : "success",
    });
    return result;
  } catch (error) {
    await appendTrace({
      timestamp: new Date().toISOString(),
      serverVersion: SERVER_VERSION,
      method: ctx.method,
      tool: ctx.params.name,
      arguments: ctx.params.arguments ?? {},
      durationMs: Date.now() - startedAt,
      outcome: "protocol_error",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

const modeSchema = z.enum(["baseline", "remediated"]);

const resetOutputSchema = z.object({
  mode: modeSchema,
  issueCount: z.number().int().nonnegative(),
  sandbox: z.string(),
});

export const benchmarkReset = server.tool(
  {
    name: "benchmark-reset",
    title: "Reset benchmark sandbox",
    description:
      "Reset deterministic local test data. Use only between benchmark attempts.",
    inputSchema: z.object({
      mode: modeSchema.describe(
        "baseline reproduces the labeled idempotency regression; remediated enables duplicate protection"
      ),
    }),
    outputSchema: resetOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ mode }) => {
    const data = await resetSandbox(mode as BenchmarkMode);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
);

const issueSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  title: z.string(),
  description: z.string(),
  project: z.literal("Mobile"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  assignee: z.literal("alex.test@example.com"),
  createdAt: z.string(),
});

const createIssueInputSchema = z.object({
  externalId: z
    .string()
    .min(3)
    .max(80)
    .describe("Stable caller-supplied idempotency key for this bug report"),
  title: z.string().min(5).max(120).describe("Concise issue title"),
  description: z
    .string()
    .min(10)
    .max(2000)
    .describe("Bug symptoms and reproduction context"),
  project: z.literal("Mobile").describe("Authorized sandbox project"),
  priority: z
    .enum(["low", "medium", "high", "urgent"])
    .describe("Issue priority"),
  assignee: z
    .literal("alex.test@example.com")
    .describe("Authorized sandbox test user"),
});

const createIssueOutputSchema = z.object({
  issue: issueSchema,
  created: z.boolean(),
  deduplicated: z.boolean(),
  mode: modeSchema,
});

export const createIssueTool = server.tool(
  {
    name: "create-issue",
    title: "Create sandbox issue",
    description:
      "Create an issue in the local Mobile sandbox. externalId is the idempotency key.",
    inputSchema: createIssueInputSchema,
    outputSchema: createIssueOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (input) => {
    const data = await createIssue(input);
    return {
      content: [
        {
          type: "text",
          text: data.deduplicated
            ? `Existing issue ${data.issue.id} returned; no duplicate created.`
            : `Created issue ${data.issue.id}.`,
        },
      ],
      structuredContent: data,
    };
  }
);

const getIssueOutputSchema = z.object({ issue: issueSchema });

export const getIssueTool = server.tool(
  {
    name: "get-issue",
    title: "Get sandbox issue",
    description: "Retrieve an issue from the local sandbox by its issue id.",
    inputSchema: z.object({
      id: z.string().describe("Issue id returned by create-issue"),
    }),
    outputSchema: getIssueOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ id }) => {
    const issue = await getIssue(id);
    if (!issue) {
      return {
        isError: true,
        content: [{ type: "text", text: `Issue ${id} was not found.` }],
      };
    }

    const data = { issue };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
);

export default server;
