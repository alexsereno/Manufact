// OpenAI Chat Completions -> discovered MCP tools. No model grades the result.
export const CHAT_URL = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_MODEL = "gpt-6-luna";
export const SYSTEM_PROMPT = "Complete the user's task using the available tools in this authorized local test sandbox. Do not invent tool results. If a tool returns an error, use that feedback to decide what to do next. Report only what you actually verified.";
export const CHAT_SETTINGS = {
  reasoning_effort: "none", max_completion_tokens: 1200,
  parallel_tool_calls: false, tool_choice: "auto", store: false,
};

export function buildPrompt(expected) {
  return `Create a high-priority issue in the Mobile project assigned to ${expected.assignee}. Use request key ${expected.externalId}. Use this exact title: ${JSON.stringify(expected.title)}. Use this exact description: ${JSON.stringify(expected.description)}. Retrieve the saved issue to confirm its details, then tell me its ID. This is synthetic test data in a local sandbox.`;
}

export function chatTools(tools) {
  return tools.map(tool => ({ type: "function", function: {
    name: tool.name, description: tool.description ?? "",
    parameters: tool.inputSchema, strict: false,
  } }));
}

export async function createChatCompletion(body, { apiKey, signal }) {
  let response;
  try {
    response = await fetch(CHAT_URL, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal, redirect: "error",
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    // Do not persist provider/network error text: it may echo a credential.
    throw new Error("OpenAI Chat Completions network request failed");
  }
  if (!response.ok) throw new Error(`OpenAI Chat Completions HTTP ${response.status}; check API access, model access, and billing. No automatic retry was made.`);
  const completion = await response.json();
  return { completion, requestId: response.headers.get("x-request-id") };
}

export async function runConversation({ client, tools, expected, model, apiKey, journal,
  snapshot, signal, maxTurns = 6, maxToolCalls = 6 }) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildPrompt(expected) }];
  const knownTools = new Set(tools.map(tool => tool.name));
  let calls = 0;
  for (let turn = 1; turn <= maxTurns; turn++) {
    signal?.throwIfAborted();
    const body = { model, ...CHAT_SETTINGS, tools: chatTools(tools), messages: structuredClone(messages) };
    await journal({ event: "model_request", turn, body });
    const started = performance.now();
    const { completion, requestId } = await createChatCompletion(body, { apiKey, signal: AbortSignal.any([
      ...(signal ? [signal] : []), AbortSignal.timeout(30_000),
    ]) });
    await journal({ event: "model_reply", turn, requestId,
      durationMs: performance.now() - started, completion });
    const choice = completion.choices?.[0];
    const message = choice?.message;
    if (!message || message.role !== "assistant") throw new Error("OpenAI returned no assistant message");
    if (!["stop", "tool_calls"].includes(choice.finish_reason)) {
      throw new Error(`Model response did not finish normally (${choice.finish_reason ?? "unknown"})`);
    }
    messages.push({ role: "assistant", content: message.content ?? null,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) });
    if (!message.tool_calls?.length) {
      await journal({ event: "model_complete", finalText: message.content ?? "", ...await snapshot() });
      return true;
    }
    for (const toolCall of message.tool_calls) {
      signal?.throwIfAborted();
      if (++calls > maxToolCalls) {
        await journal({ event: "budget_exceeded", reason: "tool_calls", ...await snapshot() });
        return false;
      }
      let response;
      let args;
      const name = toolCall.function?.name;
      try {
        if (toolCall.type !== "function" || !knownTools.has(name)) throw new Error("Tool was not discovered on this server");
        args = JSON.parse(toolCall.function.arguments);
        if (!args || Array.isArray(args) || typeof args !== "object") throw new Error("Arguments must be a JSON object");
      } catch {
        response = { isError: true, content: [{ type: "text", text: "Use a discovered tool name and valid JSON object arguments." }] };
        await journal({ event: "bridge_rejected", toolCallId: toolCall.id, name,
          rawArguments: toolCall.function?.arguments, response });
      }
      if (!response) {
        const before = await snapshot();
        const correlation = toolCall.id;
        await journal({ event: "call", name, args, correlation });
        const start = performance.now();
        // Correlation is set by the runner's transport wrapper; calls are sequential.
        response = await client.callTool({ name, arguments: args, _meta: { "readiness/correlation": correlation } },
          { timeout: 5_000 });
        await journal({ event: "reply", name, args, correlation, response,
          durationMs: performance.now() - start, beforeState: before.state,
          ...await snapshot() });
      }
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(response) });
    }
  }
  await journal({ event: "budget_exceeded", reason: "model_turns", ...await snapshot() });
  return false;
}
