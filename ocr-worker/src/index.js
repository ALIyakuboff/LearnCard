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

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    const ct = request.headers.get("Content-Type") || "";

    // Handle JSON translation requests (Single-word Proxy mode)
    if (ct.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      if (body.action === "translate" && (body.word || body.text)) {
        try {
          // Protocol: Expect 'word'. If 'text' provided, take first line
          let word = body.word || "";
          if (!word && body.text) {
            const match = body.text.match(/^\s*\d+[\.\)\:\s-]+\s*(.+)/);
            word = match ? match[1].trim() : body.text.trim();
          }

          if (!word) return json({ translated: "" }, 200, cors);

          // Cache check (v3)
          const cache = caches.default;
          const cacheUrl = new URL(request.url);
          cacheUrl.pathname = `/cache-v3/${encodeURIComponent(word.toLowerCase().slice(0, 50))}`;
          const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

          const cachedRes = await cache.match(cacheKey);
          if (cachedRes) return cachedRes;

          const translation = await translateWord(word, body.gasUrl);
          const response = json({ translated: translation }, 200, cors);

          if (translation && !translation.startsWith("[Error")) {
            response.headers.set("Cache-Control", "public, max-age=604800"); // 1 week
            ctx.waitUntil(cache.put(cacheKey, response.clone()));
          }
          return response;
        } catch (e) {
          return json({ error: "Translation failure", details: String(e.stack || e) }, 500, cors);
        }
      }
      return json({ error: "Invalid JSON action" }, 400, cors);
    }

    // OCR Request
    if (!ct.includes("multipart/form-data")) {
      return json({ error: "Expected multipart/form-data or application/json" }, 400, cors);
    }

    const form = await request.formData();
    const file = form.get("image");
    if (!file) return json({ error: "No image provided." }, 400, cors);

    if (!env.OCR_SPACE_API_KEY) {
      return json({ error: "OCR API key missing" }, 500, cors);
    }

    const ocrForm = new FormData();
    ocrForm.append("apikey", env.OCR_SPACE_API_KEY);
    ocrForm.append("language", "eng");
    ocrForm.append("OCREngine", "2");
    ocrForm.append("file", file, file.name || "image.png");

    try {
      const res = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: ocrForm });
      const ocrJson = await res.json();
      const text = String(ocrJson?.ParsedResults?.[0]?.ParsedText || "").trim();
      const words = text ? extractWords(text).slice(0, 100) : [];
      return json({ text, words, pairs: [] }, 200, cors);
    } catch (e) {
      return json({ error: "OCR failed", details: String(e) }, 502, cors);
    }
  },
};

function extractWords(text) {
  const raw = String(text || "").toLowerCase();
  const parts = raw.split(/[\s\n\r\t]+/g);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const w = normalizeWord(p);
    if (w && w.length >= 3 && !seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

function normalizeWord(w) {
  return String(w || "").trim().toLowerCase().replace(/[^a-z']/g, "");
}

async function translateWord(word, gasUrl = null) {
  const agents = ["dict-chrome-ex", "gtx", "webapp"];
  const domains = [
    "translate.googleapis.com",
    "clients1.google.com",
    "clients2.google.com",
    "clients5.google.com"
  ];

  // Randomize domains to distribute load
  const shuffledDomains = [...domains].sort(() => Math.random() - 0.5);

  for (const domain of shuffledDomains) {
    for (const client of agents) {
      const url = `https://${domain}/translate_a/single?client=${client}&sl=en&tl=uz&dt=t&dt=bd&q=${encodeURIComponent(word)}`;
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });

        if (res.ok) {
          const data = await res.json();
          return parseGoogleResponse(data);
        }

        if (res.status === 429) {
          // IP blocked for this combo, wait a bit but try next
          await sleep(200);
        }
      } catch (e) { }
    }
  }

  // --- LAST RESORT: Google Apps Script ---
  if (gasUrl) {
    try {
      const gUrl = `${gasUrl}?q=${encodeURIComponent(word)}&sl=en&tl=uz`;
      const res = await fetch(gUrl);
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith("[")) {
          return parseGoogleResponse(JSON.parse(text));
        }
        return text.trim();
      }
    } catch (e) { }
  }

  return "[Error: 429 (Busy)]";
}

function parseGoogleResponse(data) {
  if (!data) return "";
  let main = (data[0] && data[0][0] && data[0][0][0]) || "";
  let synonyms = [];
  if (data[1] && Array.isArray(data[1])) {
    for (const posBlock of data[1]) {
      const synList = posBlock[1];
      if (Array.isArray(synList)) synonyms.push(...synList.slice(0, 5));
    }
  }
  const unique = Array.from(new Set([main, ...synonyms])).filter(v => v && v.trim());
  return unique.length === 0 ? "[No translation]" : unique.slice(0, 8).join(", ");
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
