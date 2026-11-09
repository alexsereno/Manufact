import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type BenchmarkMode = "baseline" | "remediated";

export type Issue = {
  id: string;
  externalId: string;
  title: string;
  description: string;
  project: "Mobile";
  priority: "low" | "medium" | "high" | "urgent";
  assignee: "alex.test@example.com";
  createdAt: string;
};

type State = {
  mode: BenchmarkMode;
  nextIssueNumber: number;
  projects: [{ name: "Mobile" }];
  users: [{ email: "alex.test@example.com" }];
  issues: Issue[];
};

type CreateIssueInput = Omit<Issue, "id" | "createdAt">;

export const statePath = resolve(
  process.env.BENCHMARK_STATE_PATH ?? "benchmark/data/state.json"
);

function initialState(mode: BenchmarkMode): State {
  return {
    mode,
    nextIssueNumber: 1,
    projects: [{ name: "Mobile" }],
    users: [{ email: "alex.test@example.com" }],
    issues: [],
  };
}

async function writeState(state: State): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

async function readState(): Promise<State> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as State;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const state = initialState("remediated");
    await writeState(state);
    return state;
  }
}

export async function resetSandbox(mode: BenchmarkMode) {
  const state = initialState(mode);
  await writeState(state);
  return { mode, issueCount: 0, sandbox: statePath };
}

export async function createIssue(input: CreateIssueInput) {
  const state = await readState();
  const existing = state.issues.find(
    (issue) => issue.externalId === input.externalId
  );

  if (state.mode === "remediated" && existing) {
    return {
      issue: existing,
      created: false,
      deduplicated: true,
      mode: state.mode,
    };
  }

  const issue: Issue = {
    ...input,
    id: `MOB-${state.nextIssueNumber}`,
    createdAt: new Date().toISOString(),
  };
  state.nextIssueNumber += 1;
  state.issues.push(issue);
  await writeState(state);

  return {
    issue,
    created: true,
    deduplicated: false,
    mode: state.mode,
  };
}

export async function getIssue(id: string): Promise<Issue | undefined> {
  const state = await readState();
  return state.issues.find((issue) => issue.id === id);
}
