// Shared streaming helpers.
//
// Electron's main process runs undici's fetch, so `res.body` is a web
// ReadableStream. Both helpers below are incremental: they hand every decoded
// chunk to `onDelta` as it arrives rather than buffering the whole response,
// which is what makes the UI feel fast against a slow local model.

async function* lines(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Keep the trailing fragment — a chunk boundary rarely lands on a newline.
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const l of parts) yield l;
    }
    if (buf.trim()) yield buf;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

// Server-sent events: `data: {...}` lines, terminated by `data: [DONE]`.
export async function readSSE(res, pick, onDelta) {
  let text = "";
  for await (const line of lines(res)) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      continue; // keep-alive or partial frame
    }
    const delta = pick(json);
    if (delta) {
      text += delta;
      onDelta?.(delta);
    }
  }
  return text;
}

// Newline-delimited JSON, as used by Ollama.
export async function readNDJSON(res, pick, onDelta) {
  let text = "";
  for await (const line of lines(res)) {
    const t = line.trim();
    if (!t) continue;
    let json;
    try {
      json = JSON.parse(t);
    } catch {
      continue;
    }
    const delta = pick(json);
    if (delta) {
      text += delta;
      onDelta?.(delta);
    }
  }
  return text;
}

// An aborted request is a deliberate user action, not a failure.
export function isAbort(e) {
  return e?.name === "AbortError" || /abort/i.test(e?.message || "");
}
