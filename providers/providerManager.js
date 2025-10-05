// providers/providerManager.js
import { runWithGemini } from "./gemini.js";
import { runWithOllama } from "./ollama.js";
import { runWithOpenAI } from "./openai.js";

export async function runLLM({
  providerSpec,
  apiKey,
  system,
  inputText,
  imageData,
}) {
  if (!providerSpec) return { error: "No provider configured" };

  if (providerSpec.type === "gemini") {
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
  const model = providerSpec.model;

  if (!apiKey)
    return { error: `Missing API key in env: ${providerSpec.apiKeyEnv}` };
  return await runWithOpenAI({
    base,
    apiKey,
    model,
    system,
    inputText,
    imageData,
  });
}
