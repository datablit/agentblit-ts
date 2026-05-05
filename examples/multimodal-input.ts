import { Agent } from "../src/index.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing environment variable ${name}.\n  export ${name}=your-value`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const llmKey = requireEnv("LLM_API_KEY");
  const agentblitKey = requireEnv("AGENTBLIT_API_KEY");
  const imageUrl = requireEnv("AGENTBLIT_IMAGE_URL");

  const agent = new Agent({
    model: process.env.LLM_MODEL?.trim() || "openai/gpt-4o-mini",
    apiKey: llmKey,
    agentblitApiKey: agentblitKey,
    systemPrompt: "You are concise.",
  });

  const userInput = [
    { type: "text" as const, text: "Describe this image in 2 short bullet points." },
    { type: "image_url" as const, image_url: { url: imageUrl, detail: "auto" as const } },
  ];

  for await (const chunk of agent.run(userInput)) {
    process.stdout.write(chunk);
  }
  process.stdout.write("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
