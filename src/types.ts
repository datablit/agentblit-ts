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

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentOptions {
  model: string;
  apiKey: string;
  agentblitApiKey: string;
  agentblitUrl?: string;
  agentId?: string;
  systemPrompt?: string;
  system_prompt?: string;
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
