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
  onDelta,
  signal,
}) {
  if (!providerSpec) return { error: "No provider configured" };

  const common = { system, inputText, imageData, onDelta, signal };

  if (providerSpec.type === "gemini") {
    if (!apiKey)
      return { error: `No API key stored for "${providerSpec.label}". Add one in Settings.` };
    return await runWithGemini({
      apiBase: providerSpec.apiBase,
      apiKey,
      model: providerSpec.model,
      ...common,
    });
  }

  if (providerSpec.type === "ollama") {
    return await runWithOllama({
      host: providerSpec.host,
      model: providerSpec.model,
      ...common,
    });
  }

  // OpenAI or compatible endpoint. Self-hosted gateways frequently need no key,
  // so only demand one for the hosted OpenAI type.
  if (!apiKey && providerSpec.type === "openai")
    return { error: `No API key stored for "${providerSpec.label}". Add one in Settings.` };

  return await runWithOpenAI({
    base: providerSpec.apiBase,
    apiKey,
    model: providerSpec.model,
    ...common,
  });
}
