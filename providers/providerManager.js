// providers/providerManager.js
import { runWithGemini } from "./gemini.js";
import { runWithOllama } from "./ollama.js";
import { runWithOpenAI } from "./openai.js";

export async function runLLM({ providerSpec, system, inputText, imageData }) {
  if (!providerSpec) return { error: "No provider configured" };

  if (providerSpec.type === "gemini") {
    const apiKey = process.env[providerSpec.apiKeyEnv] || "";
    if (!apiKey)
      return { error: `Missing API key in env: ${providerSpec.apiKeyEnv}` };
    return await runWithGemini({
      apiBase: providerSpec.apiBase,
      apiKey,
      model: providerSpec.model,
      system,
      inputText,
      imageData,
    });
  }

  if (providerSpec.type === "ollama") {
    return await runWithOllama({
      host: providerSpec.host,
      model: providerSpec.model,
      system,
      inputText,
      imageData,
    });
  }

  // OpenAI or compatible endpoint
  const base = providerSpec.apiBase;
  const key = process.env[providerSpec.apiKeyEnv] || "none";
  const model = providerSpec.model;

  return await runWithOpenAI({
    base,
    apiKey: key,
    model,
    system,
    inputText,
    imageData,
  });
}
