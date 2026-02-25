import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

const DEFAULT_MODEL = "openai:gpt-5.2";

export function getModel() {
  const spec = process.env.LLM_MODEL ?? DEFAULT_MODEL;
  console.log("spec", spec);
  const colonIndex = spec.indexOf(":");
  const provider = colonIndex > 0 ? spec.slice(0, colonIndex) : "openai";
  const modelId = colonIndex > 0 ? spec.slice(colonIndex + 1) : spec;

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      return anthropic(modelId);
    }
    case "openai":
    default: {
      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
      return openai(modelId);
    }
  }
}
