export default {
  async fetch(request, env) {
    // URL provided by user
    const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwU25xoSCC38egP4KnblHvrW88gwJwi2kLEL9O7DDpsmOONBxd4KRi3EnY9xndBxmcS/exec";

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
    if (!ct.includes("multipart/form-data")) {
      return json({ error: "Expected multipart/form-data" }, 400, cors);
    }

    const form = await request.formData();
    const file = form.get("image");
    if (!file) return json({ error: "No image provided. Use field name image." }, 400, cors);

    const maxBytes = 8 * 1024 * 1024;
    if (typeof file.size === "number" && file.size > maxBytes) {
      return json({ error: "Image too large (max 8MB)" }, 413, cors);
    }

    if (!env.OCR_SPACE_API_KEY) {
      return json({ error: "OCR API key missing on server" }, 500, cors);
    }

    const ocrForm = new FormData();
    ocrForm.append("apikey", env.OCR_SPACE_API_KEY);
    ocrForm.append("language", "eng");
    ocrForm.append("isOverlayRequired", "false");
    ocrForm.append("OCREngine", "2");
    ocrForm.append("scale", "true");
    ocrForm.append("detectOrientation", "true");
    ocrForm.append("file", file, file.name || "image.png");

    let ocrJson;
    try {
      const res = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: ocrForm });
      ocrJson = await res.json();
    } catch (e) {
      return json({ error: "OCR request failed", details: String(e?.message || e) }, 502, cors);
    }

    if (ocrJson?.IsErroredOnProcessing) {
      return json({ error: "OCR provider error", providerMessage: ocrJson?.ErrorMessage || null }, 502, cors);
    }

    const text = String(ocrJson?.ParsedResults?.[0]?.ParsedText || "").trim();
    const words = text ? extractWords(text).slice(0, 100) : [];

    // Parallel translation with concurrency control
    const concurrency = 5;
    const pairs = [];

    // Process words in chunks to avoid overwhelming the external API
    for (let i = 0; i < words.length; i += concurrency) {
      const chunk = words.slice(i, i + concurrency);
      const promises = chunk.map(async (en) => {
        // Add artificial delay to respect rate limits if needed, but run in parallel
        await sleep(Math.random() * 100);
        const uz = await myMemoryTranslate(en);
        return { en, uz };
      });

      const results = await Promise.all(promises);
      pairs.push(...results);
    }

    return json({ text, words, pairs }, 200, cors);
  },
};

function extractWords(text) {
  const raw = String(text || "").toLowerCase();
  const parts = raw.split(/[\s\n\r\t]+/g);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const w = normalizeWord(p);
    if (!w) continue;
    if (w.length < 3) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

function normalizeWord(w) {
  return String(w || "").trim().toLowerCase().replace(/[^a-z']/g, "");
}

async function myMemoryTranslate(word) {
  // Use the new Google Apps Script URL defined at the top or passed here
  const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwU25xoSCC38egP4KnblHvrW88gwJwi2kLEL9O7DDpsmOONBxd4KRi3EnY9xndBxmcS/exec";

  // 1. Fetch Synonyms from Datamuse (Free)
  let textToTranslate = word;
  try {
    const synRes = await fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=3`);
    if (synRes.ok) {
      const synData = await synRes.json();
      const synonyms = synData.map(x => x.word).slice(0, 3).join(", ");
      if (synonyms) {
        // Format: "main (syn1, syn2)"
        textToTranslate = `${word} (${synonyms})`;
      }
    }
  } catch (e) {
    // Ignore synonym fails, proceed with just word
  }

  // 2. Translate everything via Google Script
  const q = encodeURIComponent(textToTranslate);
  const url = `${GOOGLE_SCRIPT_URL}?q=${q}`;

  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return "";
    const data = await res.json();
    const t = data?.translated;
    return typeof t === "string" ? t.trim() : "";
  } catch (e) {
    // console.log("Translation error:", e);
    return "";
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
