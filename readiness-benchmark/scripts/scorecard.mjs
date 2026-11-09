import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import rubric from "../benchmark/rubric.json" with { type: "json" };

const fieldPath = z.array(z.union([z.string(), z.number().int().nonnegative()])).min(1);
const assertion = z.object({
  path: fieldPath,
  equals: z.union([z.string(), z.number(), z.boolean()]),
}).strict();
const assertions = z.array(assertion).min(1);
const profileSchema = z.object({
  version: z.literal(1),
  scope: z.string().min(1),
  attempts: z.array(z.string().min(1)).min(1),
  criteria: z.record(z.string().refine(id => id !== "authentication" && Object.hasOwn(rubric.criteria, id)), assertions).optional(),
  access: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("public"), basis: z.string().trim().min(1), anonymousOutcome: assertions }),
    z.object({ mode: z.literal("protected"), basis: z.string().trim().min(1), authorizedOutcome: assertions, denial: assertions }),
  ]),
}).strict();

function combine(statuses) {
  if (statuses.includes("Fail")) return "Fail";
  return statuses.every(status => status === "Pass") ? "Pass" : "Unverified";
}

function field(record, path) {
  for (const key of path) {
    if (record == null || !Object.hasOwn(record, key)) return undefined;
    record = record[key];
  }
  return record;
}

function evaluate(rule, record) {
  const value = field(record, rule.path);
  if (value == null) return "Unverified";
  return value === rule.equals ? "Pass" : "Fail";
}

export function grade(profile, attempts) {
  const { access, criteria } = profileSchema.parse(profile);
  if (attempts.length !== profile.attempts.length) throw new Error("Expected one record per scheduled attempt");
  const rules = access.mode === "public" ? access.anonymousOutcome : [...access.authorizedOutcome, ...access.denial];
  const observations = attempts.map(record => combine(rules.map(rule => evaluate(rule, record))));
  let status = combine(observations);
  // A failed public task alone does not establish an authentication defect.
  if (access.mode === "public" && status === "Fail") status = "Unverified";
  let answer = null;
  if (status === "Fail") answer = "Improperly authenticated";
  if (status === "Pass") answer = access.mode === "public" ? "Authentication not needed" : "Yes, authenticated";

  const rows = Object.entries(rubric.criteria).map(([id, label]) => {
    if (id === "authentication") return { id, label, status, answer };
    const rules = criteria?.[id];
    const statusForRow = rules
      ? combine(attempts.map(record => combine(rules.map(rule => evaluate(rule, record)))))
      : "Unverified";
    return { id, label, status: statusForRow };
  });
  const verdict = { Pass: "Ready", Fail: "Blocked", Unverified: "Unverified" };
  return { scope: profile.scope, basis: access.basis, observations, rows, verdict: verdict[combine(rows.map(row => row.status))] };
}

async function readAttempt(base, source) {
  const [file, index] = source.split("#");
  try {
    const data = JSON.parse(await readFile(resolve(base, file), "utf8"));
    return index === undefined ? data : data[index];
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const profiles = process.argv.slice(2);
  if (profiles.length === 1 && profiles[0] === "--standards") {
    console.log(`Manufact release rubric v${rubric.version} · sources reviewed ${rubric.reviewed}`);
    for (const [name, evidence] of Object.entries(rubric.evidenceSources)) {
      console.log(`\n${name}\n  ${evidence.use}\n  ${evidence.source}`);
    }
    for (const [name, target] of Object.entries(rubric.submissionTargets)) {
      console.log(`\n${name} · selected review checks`);
      for (const check of target.checks) console.log(`  • ${check}`);
      for (const url of target.sources) console.log(`  ${url}`);
    }
    process.exit(0);
  }
  if (!profiles.length) profiles.push( "benchmark/profiles/before.json", "benchmark/profiles/after.json");
  for (const file of profiles) {
    const profile = profileSchema.parse(JSON.parse(await readFile(file, "utf8")));
    const records = await Promise.all(profile.attempts.map(source => readAttempt(dirname(file), source)));
    const report = grade(profile, records);
    console.log(`\n${report.scope} — ${report.verdict}`);
    for (const row of report.rows) console.log(`  ${row.status.padEnd(10)} ${row.label}${row.answer ? "  → " + row.answer : ""}`);
    console.log(`  Access policy: ${report.basis}\n  Authentication evidence by attempt: ${report.observations.join(", ")}`);
    console.log(`  Evidence (relative to ${file}):\n    ${profile.attempts.join("\n    ")}`);
  }
}
