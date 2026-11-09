# MCP Launch Readiness Scorecard by Manufact

Manufact defines one [versioned rubric](benchmark/rubric.json) for every MCP. The demo grades all six criteria for the local issue server using the MCP SDK over HTTP. It checks tool discovery, a create-and-read task, the public and protected access rules, retry and error behavior, SDK compatibility, and whether a known failure is traced and every measured tool call completes within the demo budget of two seconds.

Run `npm run benchmark -- --standards` to see the Manufact evidence inputs and selected public-listing checks for ChatGPT, Claude connectors and Claude Code plugins. The local demo verifies access behavior. Marketplace review uses separate evidence for the hosted release or packaged plugin.

## Set up your .env
.env.example
```
# Add your OpenAI API key.
OPENAI_API_KEY=your-openai-api-key

# Model for the Chat Completions task (requires function calling).
OPENAI_MODEL=gpt-6-luna
```

Use Node 22.22.2 or later. In this directory, run `npm ci` once. For a full rehearsal, run:

```sh
npm run demo
```

That builds the server, resets the filming evidence and runs both scenes. 

You can work through the demo in stages:
```sh
npm run --silent demo:reset
npm run --silent demo:before
npm run --silent demo:after
```

Both scenes start a fresh loopback server with one public issue. The same anonymous client reads it and attempts a write. A second client presents the local writer's temporary bearer credential. The before scene has write authentication disabled. The after scene enables it.

Reset displays the six release criteria as Pending. Each scene prints the MCP replies and issue counts, then ends on that same rubric. The before scene shows 5/6 passed and Blocked. The after scene enables the writer requirement and shows 6/6 passed. Run `npm run benchmark` to display the full scorecard from those captures.

## What happens in each attempt

1. Discover the tools from the local MCP server.
2. Give the model a plain-language request to create the specified issue and retrieve it.
3. Execute the model's chosen tool calls over MCP. Save the actual API replies, tool results, and direct database snapshots.
4. Retry the issue creation with the same request key and check that it creates no duplicate.
5. Submit an invalid priority and check that it returns the right error without changing data.
6. Attempt a new anonymous write and check whether it is denied.
7. Check that the rejected invalid-input call appears in the server log.
8. Grade every requirement and produce one launch verdict.

Code checks the saved outcomes. The model's claim that it completed the task does not determine the verdict. A failed required check makes the result Blocked; untested requirements prevent Ready. An interruption or API failure remains visible.

This earlier model experiment runs the sandbox with write authentication disabled. The filming demo above uses two client identities to verify the fix.

## Configuration

The implementation uses [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) with function definitions taken from the MCP's discovered schemas. The default [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) is called with reasoning effort `none`, automatic tool selection, sequential tool calls, and at most 1,200 completion tokens per response.

Each attempt allows six model requests, six model-selected tool calls, three scripted calls, 30 seconds per API request, and 120 seconds after server startup. No automatic API retries or model substitutions occur. A model selected through `OPENAI_MODEL` or `--model` must accept these Chat Completions settings and support function calling.

```sh
npm run benchmark:agent -- --repetitions 3 --model gpt-6-luna
```

The API key is not written to the evidence or passed to the local MCP server.

## Inspect and regrade the evidence

| File | Contents |
| --- | --- |
| `manifest.json` | Release scope, required checks, task, prompts, initial state, model settings, limits, versions, and source/build hashes. |
| `verifier.mjs` | Frozen checking code used by this run. |
| `REPORT.md`, `release.json` | Human-readable report and machine-readable launch decision. |
| `results.json`, `summary.json` | Checks per attempt and overall verdict counts. |
| `<attempt>/events.jsonl` | API requests and replies, model tool calls, scripted probes, responses, state snapshots, and execution outcome. |
| `<attempt>/tools.json` | Discovered MCP tool definitions. |
| `<attempt>/trace.jsonl` | Server logs, including the rejected invalid-input call. |
| `<attempt>/state.json` | Final stored data. The anonymous probe leaves a second issue when authentication is missing. |

Regrade with the saved rules without making API calls:

```sh
node runs/<run-directory>/verifier.mjs runs/<run-directory>
```

Or explicitly use the current checker:

```sh
npm run report -- runs/<run-directory>
```

Current rules can change an older result; the saved verifier preserves the original rules. These are inspectable local files, not tamper-proof evidence.

## Scope and handoff

This is one local workflow with synthetic data, one model, and one MCP client. It does not establish security, general model quality, concurrent retry safety, hosted reliability, or marketplace acceptance. Hosted checks require separate evidence.