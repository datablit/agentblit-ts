import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { ChatMemory } from "./memory.js";
import {
  AgentConfig,
  AgentOptions,
  ChatMessage,
  OpenAIToolCall,
  ToolHandler,
} from "./types.js";
import { ToolRegistry } from "./tools.js";
import { DebugLogger, jsonDumpsSafe, nowIsoTimestamp, randomId } from "./utils.js";

const VENDOR_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
};

const DEFAULT_TOOL_USAGE_INSTRUCTION =
  "Use tools when they help answer accurately.";

function resolveVendorAndModel(modelInput: string): { vendor: string; model: string } {
  const model = modelInput.trim();
  if (!model || !model.includes("/")) {
    throw new Error(
      "model must be in the format 'vendor/model', for example 'openai/gpt-4o-mini'.",
    );
  }
  const [vendorRaw, ...rest] = model.split("/");
  const vendor = (vendorRaw ?? "").trim().toLowerCase();
  const providerModel = rest.join("/").trim();
  if (!vendor || !providerModel) {
    throw new Error(
      "model must be in the format 'vendor/model', for example 'openai/gpt-4o-mini'.",
    );
  }
  return { vendor, model: providerModel };
}

function resolveLlmUrl(vendor: string): string {
  const url = VENDOR_BASE_URLS[vendor];
  if (!url) {
    const supported = Object.keys(VENDOR_BASE_URLS).sort().join(", ");
    throw new Error(`Unsupported model vendor '${vendor}'. Supported vendors: ${supported}.`);
  }
  return url;
}

function composeSystemPrompt(systemPrompt: string): string {
  const userPrompt = systemPrompt.trim();
  if (userPrompt.toLowerCase().includes(DEFAULT_TOOL_USAGE_INSTRUCTION.toLowerCase())) {
    return userPrompt;
  }
  if (!userPrompt) {
    return DEFAULT_TOOL_USAGE_INSTRUCTION;
  }
  return `${userPrompt}\n\n${DEFAULT_TOOL_USAGE_INSTRUCTION}`;
}

function formatMessagesForSummary(messages: ChatMessage[]): string {
  return messages
    .map((message, index) => {
      if (message.role === "assistant" && message.tool_calls) {
        return `[${index}] assistant (tool_calls): ${jsonDumpsSafe(message.tool_calls)}`;
      }
      return `[${index}] ${message.role}: ${message.content ?? ""}`;
    })
    .join("\n");
}

interface EventPayload {
  id: string;
  session_id: string;
  agent_id: string;
  timestamp: string;
  type: string;
  data: unknown;
  tokens: number;
  latency_ms: number;
}

export class Agent {
  readonly vendor: string;
  readonly model: string;
  readonly llmUrl: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly config: AgentConfig;
  readonly memory: ChatMemory;

  private readonly client: OpenAI;
  private readonly tools: ToolRegistry;
  private readonly systemPrompt: string;
  private readonly timeout: number;
  private readonly debug: DebugLogger;
  private readonly approvalCallback?: AgentOptions["approvalCallback"];
  private readonly maxToolRounds: number;
  private readonly eventBaseUrl: string;
  private readonly eventApiKey: string;
  private readonly pendingCustomEvents: EventPayload[] = [];
  private agentInitSent = false;
  private toolsSignature?: string;

  constructor(options: AgentOptions) {
    const agentblitApiKey = options.agentblitApiKey.trim();
    if (!agentblitApiKey) {
      throw new Error("agentblitApiKey is required");
    }
    const maxHistory = options.maxHistory ?? 5;
    if (maxHistory < 1) {
      throw new Error("maxHistory must be at least 1");
    }
    const maxToolRounds = options.maxToolRounds ?? 25;
    if (maxToolRounds < 1) {
      throw new Error("maxToolRounds must be at least 1");
    }

    const { vendor, model } = resolveVendorAndModel(options.model);
    const llmUrl = resolveLlmUrl(vendor);
    const timeoutSeconds = options.timeout ?? 30;
    const timeoutMs = timeoutSeconds * 1000;
    const agentblitUrl = (options.agentblitUrl ?? "https://console.agentblit.com").replace(/\/$/, "");
    const systemPrompt = composeSystemPrompt(options.systemPrompt ?? options.system_prompt ?? "");

    this.vendor = vendor;
    this.model = model;
    this.llmUrl = llmUrl;
    this.systemPrompt = systemPrompt;
    this.timeout = timeoutMs;
    this.approvalCallback = options.approvalCallback;
    this.maxToolRounds = maxToolRounds;
    this.agentId = options.agentId?.trim() || randomUUID();
    this.sessionId = randomUUID();
    this.eventBaseUrl = agentblitUrl;
    this.eventApiKey = agentblitApiKey;
    this.debug = new DebugLogger(Boolean(options.debug));

    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: llmUrl,
      timeout: timeoutMs,
    });
    this.tools = new ToolRegistry({
      baseUrl: agentblitUrl,
      apiKey: agentblitApiKey,
      timeout: timeoutMs,
    });
    for (const customTool of options.customTools ?? []) {
      this.registerTool(customTool);
    }
    this.memory = new ChatMemory({
      maxHistory,
      summarizeFn: (older) => this.summarizeOlderMessages(older),
    });
    this.config = Object.freeze({
      model: this.model,
      vendor: this.vendor,
      llmUrl: this.llmUrl,
      agentblitUrl: this.eventBaseUrl,
      systemPrompt: this.systemPrompt,
      maxHistory,
      debug: Boolean(options.debug),
      timeout: timeoutSeconds,
      agentId: this.agentId,
      sessionId: this.sessionId,
    });
  }

  registerTool(fn: ToolHandler): void {
    this.tools.register(fn);
  }

  track(eventType: string, properties: Record<string, unknown>): void {
    this.pendingCustomEvents.push(this.makeEvent({ eventType, data: properties }));
  }

  private makeEvent(input: {
    eventType: string;
    data: unknown;
    tokens?: number;
    latencyMs?: number;
  }): EventPayload {
    return {
      id: randomId("evt"),
      session_id: this.sessionId,
      agent_id: this.agentId,
      timestamp: nowIsoTimestamp(),
      type: input.eventType,
      data: input.data,
      tokens: Math.max(0, Math.trunc(input.tokens ?? 0)),
      latency_ms: Math.max(0, Math.trunc(input.latencyMs ?? 0)),
    };
  }

  private async flushEvents(events: EventPayload[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const url = `${this.eventBaseUrl}/api/events/batch`;
    this.debug.log("Event batch send start url=%s count=%s", url, events.length);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "X-API-Key": this.eventApiKey,
          "Content-Type": "application/json",
        },
        body: jsonDumpsSafe({ events }),
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 1000);
        this.debug.log(
          "Failed to send events batch status=%s body=%s",
          response.status,
          body,
        );
        return;
      }
      this.debug.log("Event batch send success status=%s count=%s", response.status, events.length);
    } catch (error) {
      this.debug.log("Failed to send events batch: %s", String(error));
    }
  }

  private extractLlmEventMessages(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length === 0) {
      return [];
    }
    const summaryMessage = messages.find(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.startsWith("Summary of earlier conversation:"),
    );
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      return [];
    }
    if (!summaryMessage) {
      return [lastMessage];
    }
    if (summaryMessage === lastMessage) {
      return [summaryMessage];
    }
    return [summaryMessage, lastMessage];
  }

  private async summarizeOlderMessages(older: ChatMessage[]): Promise<string> {
    const text = formatMessagesForSummary(older);
    this.debug.log("Summarizing %s older messages", older.length);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "Summarize the conversation excerpt below for use as memory. Preserve key facts, decisions, and tool outcomes. Be concise.",
        },
        { role: "user", content: text },
      ],
      temperature: 0.2,
    });
    return response.choices[0]?.message?.content?.trim() ?? "";
  }

  async *run(userMessage: string): AsyncGenerator<string> {
    const events: EventPayload[] = [...this.pendingCustomEvents];
    this.pendingCustomEvents.length = 0;
    try {
      this.memory.append({ role: "user", content: userMessage });
      await this.tools.refreshRemote();
      const openaiTools = this.tools.toOpenAITools();
      const toolsSignature = jsonDumpsSafe(openaiTools);
      if (!this.agentInitSent) {
        events.push(
          this.makeEvent({
            eventType: "agent_init",
            data: { system_prompt: this.systemPrompt, tools: openaiTools },
          }),
        );
        this.agentInitSent = true;
        this.toolsSignature = toolsSignature;
      } else if (toolsSignature !== this.toolsSignature) {
        events.push(this.makeEvent({ eventType: "tools_updated", data: { tools: openaiTools } }));
        this.toolsSignature = toolsSignature;
      }
      events.push(
        this.makeEvent({
          eventType: "user_prompt",
          data: { request: { message: userMessage }, response: null },
        }),
      );

      let finishedNormally = false;
      for (let round = 0; round < this.maxToolRounds; round += 1) {
        const messages = await this.memory.buildMessagesForLLM(this.systemPrompt);
        this.debug.logLLMRequest(this.model, messages.length, openaiTools.length);
        const llmRequest = {
          model: this.model,
          messages: messages as any,
          stream: true as const,
          ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
          ...(this.vendor === "openai" || this.vendor === "openrouter"
            ? { stream_options: { include_usage: true } }
            : {}),
        };

        const llmEventRequestData = {
          model: this.model,
          messages: this.extractLlmEventMessages(messages) as any,
          stream: true,
        };

        const startedAt = Date.now();
        const stream = (await this.client.chat.completions.create(
          llmRequest as any,
        )) as unknown as AsyncIterable<any>;

        const contentParts: string[] = [];
        const toolCallsMap = new Map<
          number,
          { id: string; name: string; arguments: string }
        >();
        let finishReason: string | null = null;
        let llmTotalTokens = 0;

        for await (const chunk of stream) {
          if (chunk.usage?.total_tokens) {
            llmTotalTokens = chunk.usage.total_tokens;
          }
          const choice = chunk.choices?.[0];
          if (!choice) {
            continue;
          }
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const delta = choice.delta;
          if (!delta) {
            continue;
          }
          if (delta.content) {
            contentParts.push(delta.content);
            yield delta.content;
          }
          for (const toolCall of delta.tool_calls ?? []) {
            const index = toolCall.index ?? 0;
            const existing = toolCallsMap.get(index) ?? { id: "", name: "", arguments: "" };
            if (toolCall.id) {
              existing.id = toolCall.id;
            }
            if (toolCall.function?.name) {
              existing.name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
              existing.arguments += toolCall.function.arguments;
            }
            toolCallsMap.set(index, existing);
          }
        }

        const assistantContent = contentParts.join("") || null;
        const llmLatencyMs = Date.now() - startedAt;
        const toolCalls = [...toolCallsMap.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]): OpenAIToolCall => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: call.arguments || "{}",
            },
          }));

        events.push(
          this.makeEvent({
            eventType: "llm_call",
            data: {
              request: llmEventRequestData,
              response: {
                finish_reason: finishReason,
                content: assistantContent,
                tool_calls: toolCalls,
              },
            },
            tokens: llmTotalTokens,
            latencyMs: llmLatencyMs,
          }),
        );

        if (finishReason === "tool_calls" || toolCalls.length > 0) {
          this.debug.logToolCalls(toolCalls);
          this.memory.append({
            role: "assistant",
            content: assistantContent,
            tool_calls: toolCalls,
          });

          for (const toolCall of toolCalls) {
            const toolStartedAt = Date.now();
            const result = await this.tools.execute(
              toolCall.id,
              toolCall.function.name,
              toolCall.function.arguments,
              this.approvalCallback,
            );
            const toolLatencyMs = Date.now() - toolStartedAt;
            this.debug.logToolResult(toolCall.id, true, result);
            let parsedResponse: unknown;
            try {
              parsedResponse = JSON.parse(result);
            } catch {
              parsedResponse = { raw: result };
            }
            events.push(
              this.makeEvent({
                eventType: "tool_call",
                data: {
                  request: toolCall,
                  response: parsedResponse,
                },
                latencyMs: toolLatencyMs,
              }),
            );
            this.memory.append({
              role: "tool",
              tool_call_id: toolCall.id,
              content: result,
            });
          }
          continue;
        }

        this.memory.append({
          role: "assistant",
          content: assistantContent ?? "",
        });
        finishedNormally = true;
        break;
      }

      if (!finishedNormally) {
        throw new Error(
          `Exceeded maxToolRounds (${this.maxToolRounds}); increase maxToolRounds or simplify the task.`,
        );
      }
    } catch (error) {
      events.push(
        this.makeEvent({
          eventType: "agent_loop_error",
          data: { error: error instanceof Error ? error.message : String(error) },
        }),
      );
      throw error;
    } finally {
      this.debug.log("Queueing event flush count=%s", events.length);
      await this.flushEvents(events);
    }
  }
}
