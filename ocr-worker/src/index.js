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

    if (ct.includes("application/json")) {
      const rawBody = await request.text().catch(() => "");
      let body = {};
      try { body = JSON.parse(rawBody); } catch (e) {
        return json({ error: "Invalid JSON", raw: rawBody.slice(0, 50) }, 400, cors);
      }

      if (body.action === "translate") {
        const word = (body.word || body.text || "").toLowerCase().trim();
        if (!word) return json({ translated: "" }, 200, cors);

        // Cache V5 (Sequential)
        const cache = caches.default;
        const cacheUrl = new URL(request.url);
        cacheUrl.pathname = `/cache-v5/${encodeURIComponent(word)}`;
        const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

        const cachedRes = await cache.match(cacheKey);
        if (cachedRes) return cachedRes;

        const translation = await translateWord(word, body.gasUrl);
        const response = json({ translated: translation }, 200, cors);

        if (translation && !translation.startsWith("[")) {
          response.headers.set("Cache-Control", "public, max-age=604800");
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }
        return response;
      }
    }

    // OCR
    const form = await request.formData();
    const file = form.get("image");
    if (!file || !env.OCR_SPACE_API_KEY) return json({ error: "Missing assets" }, 400, cors);

    const ocrForm = new FormData();
    ocrForm.append("apikey", env.OCR_SPACE_API_KEY);
    ocrForm.append("language", "eng");
    ocrForm.append("OCREngine", "2");
    ocrForm.append("file", file);

    try {
      const res = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: ocrForm });
      const ocrJson = await res.json();
      const text = String(ocrJson?.ParsedResults?.[0]?.ParsedText || "").trim();
      const words = text.toLowerCase().split(/[\s\n\r\t]+/g)
        .map(w => w.replace(/[^a-z']/g, ""))
        .filter(w => w.length >= 3)
        .slice(0, 100);
      return json({ text, words: Array.from(new Set(words)), pairs: [] }, 200, cors);
    } catch (e) {
      return json({ error: "OCR failed" }, 502, cors);
    }
  },
};

async function translateWord(word, gasUrl) {
  const domains = ["translate.googleapis.com", "clients1.google.com", "clients2.google.com", "clients5.google.com"];
  const agents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
  ];

  for (const domain of domains) {
    const url = `https://${domain}/translate_a/single?client=gtx&sl=en&tl=uz&dt=t&q=${encodeURIComponent(word)}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": agents[Math.floor(Math.random() * agents.length)] } });
      if (res.ok) {
        const data = await res.json();
        const t = data?.[0]?.[0]?.[0];
        if (t) return t;
      }
    } catch (e) { }
  }

  if (gasUrl) {
    try {
      const res = await fetch(`${gasUrl}?q=${encodeURIComponent(word)}&sl=en&tl=uz`);
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
          const data = JSON.parse(text);
          return data.translated || data?.[0]?.[0]?.[0] || "[No GAS translation]";
        }
        return text.trim() || "[Empty GAS]";
      }
    } catch (e) { }
  }

  return "[Error: 429]";
}

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
} 
