export async function runWithOpenAI({
  base,
  apiKey,
  model,
  system,
  inputText,
  imageData,
}) {
  const messages = [];
  messages.push({ role: "system", content: system });
  const userParts = [];
  if (inputText) userParts.push({ type: "text", text: inputText });
  if (imageData)
    userParts.push({ type: "image_url", image_url: { url: imageData } });
  messages.push({ role: "user", content: userParts });

  const body = JSON.stringify({ model, messages, temperature: 0.2 });

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  if (!response.ok) {
    const txt = await response.text();
    return { error: `HTTP ${response.status}: ${txt}` };
  }
  const json = await response.json();
  const text = json.choices?.[0]?.message?.content?.trim() || "";
  return { text };
}
