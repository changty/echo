export async function runWithOllama({
  host,
  model,
  system,
  inputText,
  imageData,
}) {
  try {
    const hasImage = !!imageData;
    const messages = [];

    if (system && system.trim()) {
      messages.push({ role: "system", content: system });
    }

    const contentText =
      inputText && inputText.trim()
        ? inputText
        : hasImage
        ? "Please read any visible text in the image and perform the requested action."
        : "";

    const msg = { role: "user", content: contentText };

    if (hasImage) {
      const images = Array.isArray(imageData)
        ? imageData.map(toBase64).filter(Boolean)
        : [toBase64(imageData)].filter(Boolean);
      msg.images = images; // base64 strings WITHOUT the data: prefix
    }

    messages.push(msg);

    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return { error: `HTTP ${res.status}: ${txt}` };
    }

    const json = await res.json();
    const text =
      json?.message?.content?.trim?.() ??
      json?.message?.content ??
      json?.content ??
      "";
    return { text };
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}

// Accept data URL or raw base64; return pure base64
function toBase64(dataUrlOrBase64) {
  if (!dataUrlOrBase64) return null;
  const i = dataUrlOrBase64.indexOf(",");
  return i >= 0 ? dataUrlOrBase64.slice(i + 1) : dataUrlOrBase64;
}
