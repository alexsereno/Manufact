import { MCPServer } from "mcp-use";
import { z } from "zod";

import { appendTrace } from "./benchmark/trace.js";
import {
  createIssue,
  getIssue,
} from "./benchmark/store.js";

const SERVER_VERSION = "0.1.0";

const server = new MCPServer({
  name: "manufact-production-readiness-benchmark",
  title: "MCP Production Readiness Benchmark",
  version: SERVER_VERSION,
  logging: { enabled: process.env.BENCHMARK_FILMING !== "1" },
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

// Observe only benchmark tool calls. Local calls have finite JSON or SSE replies.
server.use("/mcp", async (ctx, next) => {
  const startedAt = Date.now();
  const correlation = ctx.req.header("x-readiness-call");
  const request = correlation ? await ctx.req.raw.clone().json() : null;
  await next();
  if (!correlation || process.env.BENCHMARK_TRACE_MODE !== "boundary") return;
  try {
    const body = await ctx.res.clone().text();
    const messages = body.startsWith("{") ? [body] :
      body.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5));
    for (const message of messages) {
      const reply = JSON.parse(message);
      const detail = reply.result?.content?.find((item: {type: string}) => item.type === "text")?.text ?? "";
      if (reply.result?.isError && /input validation error/i.test(detail)) {
        await appendTrace({ timestamp: new Date().toISOString(), correlation,
          serverVersion: SERVER_VERSION, method: "tools/call", durationMs: Date.now() - startedAt,
          tool: request.params.name,
          outcome: "validation_error", field: detail.match(/: (\w+): Invalid/)?.[1] });
      }
    }
  } catch (error) { console.error("Benchmark trace capture failed", String(error)); }
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
  async (input, ctx) => {
    if (process.env.BENCHMARK_WRITE_AUTH === "required") {
      const token = process.env.BENCHMARK_WRITER_TOKEN;
      if (!token || ctx.request?.header("authorization") !== `Bearer ${token}`) {
        return { isError: true, content: [{ type: "text", text: "Sign in to create an issue." }] };
      }
    }
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
