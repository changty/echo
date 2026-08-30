import { isAbort, readSSE } from "./stream.js";

export async function runWithGemini({
  apiBase,
  apiKey,
  model,
  system,
  inputText,
  imageData,
  onDelta,
  signal,
}) {
  const base = (apiBase || "https://generativelanguage.googleapis.com").replace(
    /\/+$/,
    ""
  );
  const stream = typeof onDelta === "function";
  const method = stream ? "streamGenerateContent" : "generateContent";
  const query = stream
    ? `?alt=sse&key=${encodeURIComponent(apiKey)}`
    : `?key=${encodeURIComponent(apiKey)}`;
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:${method}${query}`;

  const parts = [];
  if (inputText && inputText.trim()) parts.push({ text: inputText });
  if (imageData) {
    const { mimeType, b64 } = toInlineData(imageData);
    parts.push({ inlineData: { mimeType, data: b64 } });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.2 },
  };
  if (system && system.trim()) {
    body.systemInstruction = { role: "system", parts: [{ text: system }] };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const txt = await res.text();
      return { error: `HTTP ${res.status}: ${txt}` };
    }

    const pick = (j) =>
      (j.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text)
        .filter(Boolean)
        .join("");

    if (!stream) {
      const json = await res.json();
      return { text: pick(json).trim() };
    }

    const text = await readSSE(res, pick, onDelta);
    return { text: text.trim() };
  } catch (e) {
    if (isAbort(e)) return { aborted: true, text: "" };
    return { error: e?.message || String(e) };
  }
}

function toInlineData(dataUrlOrB64) {
  const m = /^data:(.*?);base64,(.*)$/i.exec(dataUrlOrB64 || "");
  if (m) return { mimeType: m[1] || "image/png", b64: m[2] };
  return { mimeType: "image/png", b64: dataUrlOrB64 }; // assume raw b64
}
