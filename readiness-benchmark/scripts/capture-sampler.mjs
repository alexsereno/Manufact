import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const build = new URL("../../my-mcp-app/.mcp-use/build/index.js", import.meta.url);
const { default: server } = await import(build.href);
const client = new Client({ name: "scorecard-sampler", version: "1" });
try {
  const { url } = await server.listen(0, { host: "127.0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const { tools } = await client.listTools();
  const tool = tools.find(item => item.name === "say-hello");
  if (!tool) throw new Error("say-hello missing from discovery");
  const args = { name: "Manufact" };
  const reply = await client.callTool({ name: tool.name, arguments: args });
  const capture = {
    timestamp: new Date().toISOString(), server: client.getServerVersion(),
    buildSha256: createHash("sha256").update(await readFile(build)).digest("hex"),
    identity: "anonymous", tool, args, reply, toolError: reply.isError === true,
  };
  await writeFile(new URL("../benchmark/evidence/greeting.json", import.meta.url), JSON.stringify(capture, null, 2) + "\n");
} finally {
  await client.close();
  await server.close();
}
