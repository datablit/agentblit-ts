# AgentBlit TypeScript SDK

Build LLM agents that combine AgentBlit remote tools with optional local TypeScript tools.

## Install

Published package:

```bash
npm install agentblit
```

Developing this repo locally:

```bash
npm install
npm run build
```

## Example

From this repo (uses `tsx` to run TypeScript directly):

```bash
export OPENAI_API_KEY="your-openai-key"
export AGENTBLIT_API_KEY="your-agentblit-key"
# optional: export AGENTBLIT_URL="https://console.agentblit.com"
# optional: export MODEL="openai/gpt-4o-mini"
npm install
npm run example
```

Source: [`examples/basic-agent.ts`](examples/basic-agent.ts).

## Usage

```ts
import { Agent, tool } from "agentblit";

const add = tool({
  description: "Add two integers.",
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "integer" },
      b: { type: "integer" },
    },
    required: ["a", "b"],
  },
})((a: number, b: number) => a + b);

const agent = new Agent({
  model: "openai/gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY ?? "",
  agentblitApiKey: process.env.AGENTBLIT_API_KEY ?? "",
  customTools: [add],
});

for await (const chunk of agent.run("What is 200 + 30? Use tools if needed.")) {
  process.stdout.write(chunk);
}
process.stdout.write("\n");
```

## Feature Parity with Python SDK

- Vendor routing for `openai`, `anthropic`, `gemini`, and `openrouter`
- AgentBlit remote tool listing/calling and local tool overrides
- `needs_approval` gating with callback or stdin prompt
- Streaming `agent.run()` loop with multi-round tool calling
- Memory summarization (`maxHistory`) with summary insertion
- Event tracking and batch flush (`agent_init`, `user_prompt`, `llm_call`, `tool_call`, `tools_updated`, `agent_loop_error`)
- `track()` for custom events
