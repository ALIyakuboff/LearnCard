export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

    if (url.pathname === "/translate") {
      return handleTranslate(request, cors);
    }

    return handleOcr(request, env, cors);
  },
};

async function handleOcr(request, env, cors) {
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
  ocrForm.append("file", file, file.name || "image.png");

  let data;
  try {
    const res = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: ocrForm });
    data = await res.json();
  } catch (e) {
    return json({ error: "OCR request failed", details: String(e?.message || e) }, 502, cors);
  }

  if (data?.IsErroredOnProcessing) {
    return json({ error: "OCR provider error", providerMessage: data?.ErrorMessage || null }, 502, cors);
  }

  const text = data?.ParsedResults?.[0]?.ParsedText || "";
  return json({ text }, 200, cors);
}

async function handleTranslate(request, cors) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected JSON body" }, 400, cors);
  }

  const words = Array.isArray(body?.words) ? body.words : null;
  if (!words || words.length === 0) return json({ error: "No words provided" }, 400, cors);

  const MAX_WORDS = 60;
  const cleaned = words
    .map((w) => String(w || "").trim().toLowerCase())
    .filter((w) => /^[a-z]+(?:'[a-z]+)?$/.test(w))
    .slice(0, MAX_WORDS);

  if (cleaned.length === 0) return json({ error: "No valid English words" }, 400, cors);

  const pairs = [];
  for (let i = 0; i < cleaned.length; i++) {
    const en = cleaned[i];
    const uz = await myMemoryTranslate(en);
    pairs.push({ en, uz });
    await sleep(60);
  }

  return json({ pairs }, 200, cors);
}

async function myMemoryTranslate(word) {
  const q = encodeURIComponent(word);
  const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|uz`;
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const data = await res.json();
    const t = data?.responseData?.translatedText;
    return typeof t === "string" ? t.trim() : "";
  } catch {
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
