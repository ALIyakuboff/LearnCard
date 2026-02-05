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

    // 1. Check Content-Type to distinguish between JSON (Translate) and FormData (OCR)
    const ct = request.headers.get("Content-Type") || "";

    // --- TRANSLATE ACTION ---
    if (ct.includes("application/json")) {
      const rawBody = await request.text().catch(() => "");
      let body = {};
      try { body = JSON.parse(rawBody); } catch (e) {
        return json({ error: "Invalid JSON", raw: rawBody.slice(0, 50) }, 400, cors);
      }

      if (body.action === "translate") {
        const word = (body.word || body.text || "").trim();
        if (!word) return json({ translated: "" }, 200, cors);

        // Cache V6 (Gemini)
        const cache = caches.default;
        const cacheUrl = new URL(request.url);
        cacheUrl.pathname = `/cache-gemini-v1/${encodeURIComponent(word.toLowerCase())}`;
        const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

        const cachedRes = await cache.match(cacheKey);
        if (cachedRes) return cachedRes;

        const translation = await translateWithGemini(word, env.GEMINI_API_KEY);
        const response = json({ translated: translation }, 200, cors);

        if (translation && !translation.startsWith("[")) {
          response.headers.set("Cache-Control", "public, max-age=2592000"); // 30 kun
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }
        return response;
      }
    }

    // --- OCR ACTION (Gemini Vision) ---
    try {
      const form = await request.formData();
      const file = form.get("image");
      if (!file) return json({ error: "No image provided" }, 400, cors);

      const arrayBuffer = await file.arrayBuffer();
      const base64Image = arrayBufferToBase64(arrayBuffer);
      const mimeType = file.type || "image/jpeg";

      const text = await ocrWithGemini(base64Image, mimeType, env.GEMINI_API_KEY);

      // Extract words for frontend compatibility
      const words = text.toLowerCase()
        .replace(/[^a-z0-9'\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length >= 2)
        .slice(0, 500);

      return json({
        text,
        words: Array.from(new Set(words)),
        pairs: [],
        debug: { length: text.length, count: words.length }
      }, 200, cors);

    } catch (e) {
      console.error("OCR Worker Exception:", e);
      return json({
        error: "OCR Processor Error",
        message: String(e.message || e),
        model: "gemini-1.5-flash"
      }, 500, cors);
    }
  },
};

// --- HELPER FUNCTIONS ---

async function translateWithGemini(text, apiKey) {
  if (!apiKey) return `[Error: Key missing. Type: ${typeof apiKey}]`;

  const models = ["gemini-1.5-flash", "gemini-1.5-flash-001", "gemini-1.5-pro", "gemini-pro"];
  const prompt = `Translate to Uzbek. Return ONLY the translation. Text: "${text}"`;

  let lastError = "No models available";

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });

      const data = await response.json();

      if (data.error) {
        if (data.error.code === 404 || data.error.status === "NOT_FOUND") {
          lastError = `${model}: 404 Not Found`;
          continue;
        }
        return `[Error: ${data.error.message} (Model: ${model})]`;
      }

      const translatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (translatedText) return translatedText.trim();

    } catch (e) {
      lastError = e.message;
    }
  }
  return `[Error: All models failed. Last: ${lastError}]`;
}

async function ocrWithGemini(base64Image, mimeType, apiKey) {
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  // Vision models only (gemini-pro does not support images)
  const models = ["gemini-1.5-flash", "gemini-1.5-flash-001", "gemini-1.5-pro"];

  let lastError = "No vision models available";

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [{
        parts: [
          { text: "Identify and list all English words visible in this image. Return just the words separated by spaces. Ignore non-text elements." },
          { inline_data: { mime_type: mimeType, data: base64Image } }
        ]
      }]
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();
      if (data.error) {
        if (data.error.code === 404 || data.error.status === "NOT_FOUND") {
          lastError = `${model}: 404`;
          continue;
        }
        throw new Error(data.error.message);
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text.trim();

    } catch (e) {
      lastError = e.message;
    }
  }

  throw new Error(`Vision models failed: ${lastError}`);
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
} 
