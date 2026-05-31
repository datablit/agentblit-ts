export type JSONSchema = Record<string, unknown>;

export type ToolPermissionMode = "always_allow" | "needs_approval";

export type ToolHandler = (...args: any[]) => unknown | Promise<unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  permissionMode: ToolPermissionMode;
  outputSchema?: JSONSchema;
  handler?: ToolHandler;
}

export interface AgentBlitAgentConfig {
  id: string;
  name: string;
  model: string;
  system_prompt: string;
  tools: Array<Record<string, unknown>>;
}

export interface AgentConfig {
  model: string;
  vendor: string;
  llmUrl: string;
  agentblitUrl: string;
  systemPrompt: string;
  maxHistory: number;
  debug: boolean;
  timeout: number;
  agentId: string;
  sessionId: string;
}

export type ApprovalCallback = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<boolean>;

export type SummarizeFn = (messages: ChatMessage[]) => Promise<string>;

export interface OpenAITextContentPart {
  type: "text";
  text: string;
}

export interface OpenAIImageUrlContentPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high" | string;
  };
}

export interface OpenAIFileContentPart {
  type: "file";
  file: {
    file_id?: string;
    file_data?: string;
    filename?: string;
  };
}

export type OpenAIInputContentPart =
  | OpenAITextContentPart
  | OpenAIImageUrlContentPart
  | OpenAIFileContentPart;

export type ChatMessageContent = string | OpenAIInputContentPart[] | null;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: ChatMessageContent;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export type AgentRunInput =
  | string
  | OpenAIInputContentPart[]
  | {
      content: string | OpenAIInputContentPart[];
    };

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentOptions {
  apiKey: string;
  agentblitApiKey: string;
  agentblitUrl?: string;
  /** When set, overrides the model from `GET /api/1.0/agent`. */
  model?: string;
  maxHistory?: number;
  debug?: boolean;
  timeout?: number;
  approvalCallback?: ApprovalCallback;
  customTools?: ToolHandler[];
  maxToolRounds?: number;
}

export interface ToolOptions {
  name?: string;
  description?: string;
  permissionMode?: ToolPermissionMode;
  inputSchema?: JSONSchema;
}
