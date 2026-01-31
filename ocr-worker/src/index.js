export default {
  async fetch(request, env) {
    // URL provided by user
    // URL provided by user
    // NO LONGER USED: const GOOGLE_SCRIPT_URL = "...";

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

    // NEW: Handle JSON translation requests (Proxy mode)
    if (ct.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      if (body.action === "translate" && body.text) {
        try {
          // Input: "1. word\n2. word"
          // We need to parse this back to words to get individual synonyms
          // HARD LIMIT: Process up to 25 words (safe under 50 subrequest limit)
          const lines = body.text.split("\n").slice(0, 25);
          const results = [];

          for (const line of lines) {
            // Extract word: "1. apple" -> "apple"
            const match = line.match(/^\s*\d+[\.\)\:\s-]+\s*(.+)/);
            if (match && match[1]) {
              const word = match[1].trim();
              const trans = await translateWord(word);
              results.push(`${trans}`); // just payload
              await sleep(300); // Gentle delay for Google
            } else {
              results.push("");
            }
          }

          // Reconstruct as numbered list for app.js compatibility
          // app.js expects: "1. trans\n2. trans"
          const translated = results.map((t, i) => `${i + 1}. ${t}`).join("\n");

          return json({ translated }, 200, cors);
        } catch (e) {
          return json({ error: "Translation proxy failed", details: String(e) }, 500, cors);
        }
      }
      return json({ error: "Invalid JSON action" }, 400, cors);
    }

    if (!ct.includes("multipart/form-data")) {
      return json({ error: "Expected multipart/form-data or application/json" }, 400, cors);
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

    // SKIP server-side translation to avoid "Too many subrequests" error.
    // Client will handle translation via "Translate & Create" button using safe batching.
    const pairs = [];

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

const AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1"
];

function getRandomAgent() {
  return AGENTS[Math.floor(Math.random() * AGENTS.length)];
}

async function translateWord(word) {
  // Use Google Translate internal API (GTX)
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=uz&dt=t&dt=bd&q=${encodeURIComponent(word)}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": getRandomAgent()
      }
    });

    if (!res.ok) {
      if (res.status === 429) return "[Error: 429 (Rate Limit)]";
      return `[Error: ${res.status}]`;
    }

    const data = await res.json();

    // 1. Primary translation
    let mainTranslation = "";
    if (data[0] && data[0][0] && data[0][0][0]) {
      mainTranslation = data[0][0][0];
    }

    // 2. Synonyms (if available) - usually data[1]
    let synonyms = [];
    if (data[1] && Array.isArray(data[1])) {
      // data[1] is list of POS categories: [ ["noun", ["syn1", "syn2"], ...], ["verb", ...]]
      for (const posBlock of data[1]) {
        const synList = posBlock[1]; // array of synonyms
        if (Array.isArray(synList)) {
          // Take up to 5 synonyms from each category to include more nuances (verbs, nouns)
          synonyms.push(...synList.slice(0, 5));
        }
      }
    }

    // Combine unique values and clean up
    const candidates = [];
    if (mainTranslation) candidates.push(mainTranslation);
    candidates.push(...synonyms);

    // Deduplicate with specific Uzbek heuristics (h/x swapping)
    const unique = [];
    const seenKeys = new Set();

    for (const raw of candidates) {
      const w = String(raw).trim();
      if (!w) continue;

      const lower = w.toLowerCase();
      // Create a 'normalized' key for comparison that ignores h/x difference and quotes
      // This helps dedup 'xavf' vs 'havf' or "o'zbek" vs "o`zbek"
      const key = lower
        .replace(/[hx]/g, 'h') // treat h and x as same for duplicate detection
        .replace(/['`‘’]/g, '') // ignore quotes
        .replace(/\s+/g, ' ');

      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        unique.push(w);
      }
    }

    // Fallback if empty but success
    if (unique.length === 0) return "[No translation found]";

    return unique.slice(0, 8).join(", "); // Increased limit to 8
  } catch (e) {
    return `[Exception: ${e.message}]`;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
