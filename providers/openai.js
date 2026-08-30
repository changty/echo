import { isAbort, readSSE } from "./stream.js";

export async function runWithOpenAI({
  base,
  apiKey,
  model,
  system,
  inputText,
  imageData,
  onDelta,
  signal,
}) {
  const userParts = [];
  if (inputText) userParts.push({ type: "text", text: inputText });
  if (imageData)
    userParts.push({ type: "image_url", image_url: { url: imageData } });

  const messages = [
    { role: "system", content: system },
    { role: "user", content: userParts },
  ];

  const stream = typeof onDelta === "function";

  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.2, stream }),
      signal,
    });

    if (!response.ok) {
      const txt = await response.text();
      return { error: `HTTP ${response.status}: ${txt}` };
    }

    if (!stream) {
      const json = await response.json();
      return { text: json.choices?.[0]?.message?.content?.trim() || "" };
    }

    const text = await readSSE(
      response,
      (j) => j.choices?.[0]?.delta?.content,
      onDelta
    );
    return { text: text.trim() };
  } catch (e) {
    if (isAbort(e)) return { aborted: true, text: "" };
    return { error: e?.message || String(e) };
  }
}
