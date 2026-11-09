import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const tracePath = resolve(
  process.env.BENCHMARK_TRACE_PATH ?? "benchmark/data/server-trace.jsonl"
);

const sensitiveKey = /authorization|cookie|password|secret|token/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redact(item),
    ])
  );
}

export async function appendTrace(record: Record<string, unknown>) {
  await mkdir(dirname(tracePath), { recursive: true });
  await appendFile(tracePath, `${JSON.stringify(redact(record))}\n`, "utf8");
}
