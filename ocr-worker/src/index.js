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

        const translation = await translateWord(word, body.gasUrl, env.AI);
        const response = json({ translated: translation }, 200, cors);

        if (translation && !translation.startsWith("[")) {
          response.headers.set("Cache-Control", "public, max-age=604800");
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }
        return response;
      }
    }

    // OCR using Cloudflare Workers AI (FREE 300k/month!)
    const form = await request.formData();
    const file = form.get("image");
    if (!file) return json({ error: "No image provided" }, 400, cors);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Ultra-fast base64 conversion for Cloudflare Workers (avoids CPU limit)
      const base64Image = btoa(new TextDecoder('latin1').decode(uint8Array));

      // Original prompt that gave 90+ words
      const aiResponse = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
        image: base64Image,
        prompt: "Identify and list all English words visible in this image. Return just the text separated by spaces.",
        max_tokens: 1536
      });

      const text = String(aiResponse?.description || aiResponse?.text || "").trim();

      // Extract words accurately
      const words = text.toLowerCase()
        .replace(/[^a-z0-9'\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length >= 2)
        .slice(0, 500);

      return json({ text, words: Array.from(new Set(words)), pairs: [] }, 200, cors);
    } catch (e) {
      return json({ error: "OCR failed", details: String(e.message || e) }, 502, cors);
    }
  },
};

async function translateWord(word, gasUrl, ai) {
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

  // Fallback: Cloudflare Workers AI (Scalable for 1000+ users)
  if (ai) {
    try {
      const response = await ai.run("@cf/meta/m2m100-1.2b", {
        text: word,
        source_lang: "en",
        target_lang: "uz"
      });
      if (response && response.translated_text) {
        return response.translated_text;
      }
    } catch (e) {
      // AI failed
    }
  }

  return "[Error: 429]";
}

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
} 
