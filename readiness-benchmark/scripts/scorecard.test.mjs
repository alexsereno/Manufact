import test from "node:test";
import assert from "node:assert/strict";
import { grade } from "./scorecard.mjs";

const rule = key => [{ path: [key], equals: true }];
const profile = {
  version: 1, scope: "Private lookup", attempts: ["attempt.json"],
  access: { mode: "protected", basis: "Account data", authorizedOutcome: rule("allowed"), denial: rule("denied") },
};
const publicProfile = { ...profile, access: { mode: "public", basis: "Public catalog", anonymousOutcome: rule("publicResult") } };
test("the same rubric yields three authentication answers and preserves evidence gaps", () => {
  for (const [fixture, record, status, answer, overall] of [
    [profile, { allowed: true, denied: true }, "Pass", "Yes, authenticated", "Unverified"],
    [profile, { denied: true }, "Unverified", null, "Unverified"],
    [profile, { denied: false }, "Fail", "Improperly authenticated", "Blocked"],
    [publicProfile, { publicResult: true }, "Pass", "Authentication not needed", "Unverified"],
    [publicProfile, { publicResult: false }, "Unverified", null, "Unverified"],
    [publicProfile, null, "Unverified", null, "Unverified"],
  ]) {
    const report = grade(fixture, [record]);
    assert.equal(report.verdict, overall);
    assert.equal(report.rows.length, 6);
    const row = report.rows.find(item => item.id === "authentication");
    assert.equal(row.status, status);
    assert.equal(row.answer, answer);
  }
});
