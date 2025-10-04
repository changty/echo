import { runWithOllama } from "./ollama.js";
import { runWithOpenAI } from "./openai.js";

export async function runLLM({
  provider,
  config,
  system,
  inputText,
  imageData,
}) {
  if (provider === "ollama") {
    return await runWithOllama({
      host: config.ollama.host,
      model: config.ollama.model,
      system,
      inputText,
      imageData,
    });
  }

  // OpenAI or OpenAI-compatible
  const base =
    provider === "openai"
      ? config.openai.apiBase
      : config.openaiCompatible.apiBase;
  const key =
    provider === "openai"
      ? process.env[config.openai.apiKeyEnv]
      : process.env[config.openaiCompatible.apiKeyEnv] || "none";
  const model =
    provider === "openai" ? config.openai.model : config.openaiCompatible.model;

  return await runWithOpenAI({
    base,
    apiKey: key,
    model,
    system,
    inputText,
    imageData,
  });
}
