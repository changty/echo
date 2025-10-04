export async function runWithGemini({
  apiBase,
  apiKey,
  model,
  system,
  inputText,
  imageData,
}) {
  const base = (apiBase || "https://generativelanguage.googleapis.com").replace(
    /\/+$/,
    ""
  );
  const url = `${base}/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;
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

  const res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    return { error: `HTTP ${res.status}: ${txt}` };
  }

  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join("")
    .trim();

  return { text };
}

function toInlineData(dataUrlOrB64) {
  const m = /^data:(.*?);base64,(.*)$/i.exec(dataUrlOrB64 || "");
  if (m) return { mimeType: m[1] || "image/png", b64: m[2] };
  return { mimeType: "image/png", b64: dataUrlOrB64 }; // assume raw b64
}
