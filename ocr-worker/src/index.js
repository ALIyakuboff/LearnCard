export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

    const ct = request.headers.get("Content-Type") || "";

    // Handle JSON translation requests (Single-word Proxy mode)
    if (ct.includes("application/json")) {
      const rawBody = await request.text().catch(() => "");
      let body = {};
      try { body = JSON.parse(rawBody); } catch (e) {
        return json({ error: "Invalid JSON format", raw: rawBody.slice(0, 100) }, 400, cors);
      }

      if (body.action === "translate" && (body.word || body.text)) {
        try {
          const word = (body.word || body.text || "").toLowerCase().trim();
          if (!word) return json({ translated: "" }, 200, cors);

          // Cache check (v4)
          const cache = caches.default;
          const cacheUrl = new URL(request.url);
          cacheUrl.pathname = `/cache-v4/${encodeURIComponent(word)}`;
          const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

          const cachedRes = await cache.match(cacheKey);
          if (cachedRes) return cachedRes;

          const translation = await translateWord(word, body.gasUrl);
          const response = json({ translated: translation }, 200, cors);

          if (translation && !translation.startsWith("[Error")) {
            response.headers.set("Cache-Control", "public, max-age=604800");
            ctx.waitUntil(cache.put(cacheKey, response.clone()));
          }
          return response;
        } catch (e) {
          return json({ error: "Worker crash", details: String(e.stack || e) }, 500, cors);
        }
      }
      return json({ error: "Action not supported", body }, 400, cors);
    }

    // OCR Request
    if (!ct.includes("multipart/form-data")) {
      return json({ error: "Expected multipart/form-data" }, 400, cors);
    }

    const form = await request.formData();
    const file = form.get("image");
    if (!file) return json({ error: "No image" }, 400, cors);
    if (!env.OCR_SPACE_API_KEY) return json({ error: "OCR API key missing" }, 500, cors);

    const ocrForm = new FormData();
    ocrForm.append("apikey", env.OCR_SPACE_API_KEY);
    ocrForm.append("language", "eng");
    ocrForm.append("OCREngine", "2");
    ocrForm.append("file", file);

    try {
      const res = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: ocrForm });
      const ocrJson = await res.json();
      const text = String(ocrJson?.ParsedResults?.[0]?.ParsedText || "").trim();
      const words = extractWords(text);
      return json({ text, words, pairs: [] }, 200, cors);
    } catch (e) {
      return json({ error: "OCR failed", details: String(e) }, 502, cors);
    }
  },
};

function extractWords(text) {
  const parts = String(text || "").toLowerCase().split(/[\s\n\r\t]+/g);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const w = p.trim().replace(/[^a-z']/g, "");
    if (w.length >= 3 && !seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

async function translateWord(word, gasUrl) {
  // Primary: Google Translate Free API (Direct)
  const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=uz&dt=t&q=${encodeURIComponent(word)}`;
  try {
    const res = await fetch(gUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
    });
    if (res.ok) {
      const data = await res.json();
      const t = parseGoogleResponse(data);
      if (t && !t.startsWith("[No")) return t;
    }
  } catch (e) { }

  // Secondary: GAS Fallback
  if (gasUrl) {
    try {
      const res = await fetch(`${gasUrl}?q=${encodeURIComponent(word)}&sl=en&tl=uz`);
      if (res.ok) {
        const text = await res.text();
        const trimmed = text.trim();
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
          const data = JSON.parse(trimmed);
          if (data.translated) return data.translated;
          return parseGoogleResponse(data);
        }
        return trimmed || "[No result from GAS]";
      }
    } catch (e) {
      return `[GAS Error: ${e.message}]`;
    }
  }

  return "[Error: Translation blocked]";
}

function parseGoogleResponse(data) {
  try {
    if (!data) return "";
    let t = (data[0] && data[0][0] && data[0][0][0]) || "";
    if (!t && data.translated) t = data.translated; // Fallback for some proxies
    return t || "[No translation]";
  } catch (e) {
    return "[Parsing error]";
  }
}

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
