import { createOpenAI } from "@ai-sdk/openai";

export function getModel() {
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai(process.env.OPENAI_MODEL ?? "gpt-5.2");
}
