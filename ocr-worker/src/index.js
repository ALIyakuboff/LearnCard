export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
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

    // Default "/" => OCR
    return handleOcr(request, env, cors);
  },
};

async function handleOcr(request, env, cors) {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const ct = request.headers.get("Content-Type") || "";
  if (!ct.includes("multipart/form-data")) {
    return new Response(
      JSON.stringify({ error: "Expected multipart/form-data" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const form = await request.formData();
  const file = form.get("image");

  if (!file) {
    return new Response(
      JSON.stringify({ error: "No image provided. Use field name image." }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const maxBytes = 8 * 1024 * 1024;
  if (typeof file.size === "number" && file.size > maxBytes) {
    return new Response(
      JSON.stringify({ error: "Image too large (max 8MB)" }),
      { status: 413, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  if (!env.OCR_SPACE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "OCR API key missing on server" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const ocrForm = new FormData();
  ocrForm.append("apikey", env.OCR_SPACE_API_KEY);
  ocrForm.append("language", "eng");
  ocrForm.append("isOverlayRequired", "false");
  ocrForm.append("OCREngine", "2");
  ocrForm.append("scale", "true");
  ocrForm.append("file", file, file.name || "image.png");

  let json;
  try {
    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: ocrForm,
    });
    json = await res.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "OCR request failed", details: String(e?.message || e) }),
      { status: 502, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  if (json?.IsErroredOnProcessing) {
    return new Response(
      JSON.stringify({ error: "OCR provider error", providerMessage: json?.ErrorMessage || null }),
      { status: 502, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const text = json?.ParsedResults?.[0]?.ParsedText || "";
  return new Response(
    JSON.stringify({ text }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
  );
}

async function handleTranslate(request, cors) {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Expected JSON body" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const words = Array.isArray(body?.words) ? body.words : null;
  if (!words || words.length === 0) {
    return new Response(
      JSON.stringify({ error: "No words provided" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  // safety cap
  const MAX_WORDS = 60;
  const cleaned = words
    .map((w) => String(w || "").trim().toLowerCase())
    .filter((w) => /^[a-z]+(?:'[a-z]+)?$/.test(w))
    .slice(0, MAX_WORDS);

  if (cleaned.length === 0) {
    return new Response(
      JSON.stringify({ error: "No valid English words" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const pairs = [];
  for (let i = 0; i < cleaned.length; i++) {
    const en = cleaned[i];
    const uz = await myMemoryTranslate(en);
    pairs.push({ en, uz });
    await sleep(80);
  }

  return new Response(
    JSON.stringify({ pairs }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
  );
}

async function myMemoryTranslate(word) {
  const q = encodeURIComponent(word);
  const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|uz`;
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const json = await res.json();
    const t = json?.responseData?.translatedText;
    return typeof t === "string" ? t.trim() : "";
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
