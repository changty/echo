import http from "http";
import { runWithOpenAI } from "../providers/openai.js";
import { runWithOllama } from "../providers/ollama.js";
import { runWithGemini } from "../providers/gemini.js";

const out = [];
const ok = (n, c, extra="") => out.push(`${c?"PASS":"FAIL"}  ${n}${extra?" — "+extra:""}`);

// Mock server: emits chunks split at awkward boundaries to exercise the
// buffering in stream.js (a chunk deliberately ends mid-JSON-line).
const server = http.createServer((req, res) => {
  const url = req.url;
  if (url.startsWith("/v1/chat/completions")) {
    res.writeHead(200, {"Content-Type":"text/event-stream"});
    res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"lo "}}]}\n\ndata: {"choices":[{"delta":{"con');
    setTimeout(()=>{
      res.write('tent":"wor"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"ld"}}]}\n\ndata: [DONE]\n\n');
      res.end();
    }, 20);
    return;
  }
  if (url.startsWith("/api/chat")) {
    res.writeHead(200, {"Content-Type":"application/x-ndjson"});
    res.write('{"message":{"content":"Hel"}}\n{"message":{"content":"lo "}}\n{"messa');
    setTimeout(()=>{
      res.write('ge":{"content":"world"}}\n{"done":true}\n');
      res.end();
    }, 20);
    return;
  }
  if (url.includes("streamGenerateContent")) {
    res.writeHead(200, {"Content-Type":"text/event-stream"});
    res.write('data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\n');
    res.write('data: {"candidates":[{"content":{"parts":[{"text":"world"}]}}]}\n\ndata: [DONE]\n\n');
    res.end();
    return;
  }
  if (url.includes(":generateContent")) {
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({candidates:[{content:{parts:[{text:"Hello world"}]}}]}));
    return;
  }
  if (url.startsWith("/slow")) {           // for the abort test
    res.writeHead(200, {"Content-Type":"text/event-stream"});
    res.write('data: {"choices":[{"delta":{"content":"start"}}]}\n\n');
    return; // never ends
  }
  res.writeHead(404); res.end();
});

await new Promise(r => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

// --- OpenAI streaming
let deltas = [];
let r = await runWithOpenAI({ base: `${base}/v1`, apiKey:"k", model:"m", system:"s",
  inputText:"hi", onDelta: d => deltas.push(d) });
ok("openai stream text", r.text === "Hello world", JSON.stringify(r.text));
ok("openai stream deltas incremental", deltas.length === 4, JSON.stringify(deltas));

// --- OpenAI non-streaming still works (no onDelta)
// (mock only implements SSE, so just confirm streaming flag is what differs)

// --- Ollama streaming
deltas = [];
r = await runWithOllama({ host: base, model:"m", system:"s", inputText:"hi",
  onDelta: d => deltas.push(d) });
ok("ollama stream text", r.text === "Hello world", JSON.stringify(r.text));
ok("ollama stream deltas", deltas.join("") === "Hello world", JSON.stringify(deltas));

// --- Gemini streaming
deltas = [];
r = await runWithGemini({ apiBase: base, apiKey:"k", model:"m", system:"s",
  inputText:"hi", onDelta: d => deltas.push(d) });
ok("gemini stream text", r.text === "Hello world", JSON.stringify(r.text));

// --- Gemini non-streaming path
r = await runWithGemini({ apiBase: base, apiKey:"k", model:"m", system:"s", inputText:"hi" });
ok("gemini non-stream text", r.text === "Hello world", JSON.stringify(r.text));

// --- abort produces {aborted:true}, not an error
const ac = new AbortController();
const p = runWithOpenAI({ base: `${base}/slow`, apiKey:"k", model:"m", system:"s",
  inputText:"hi", onDelta: ()=>{}, signal: ac.signal });
setTimeout(()=>ac.abort(), 60);
r = await p;
ok("abort returns aborted, not error", r.aborted === true && !r.error, JSON.stringify(r));

// --- HTTP error surfaces cleanly
r = await runWithOpenAI({ base: `${base}/nope`, apiKey:"k", model:"m", system:"s", inputText:"hi" });
ok("http error surfaced", !!r.error && /404/.test(r.error), r.error?.slice(0,40));

console.log("\n===RESULTS===\n"+out.join("\n")+"\n===END===");
server.close();
process.exit(out.some(l=>l.startsWith("FAIL"))?1:0);
