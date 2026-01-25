// Cloudflare Worker — OCR + Translation
// Deploy: wrangler deploy

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Faqat POST
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    const ct = request.headers.get("Content-Type") || "";
    if (!ct.includes("multipart/form-data")) {
      return json({ error: "Expected multipart/form-data" }, 400, cors);
    }

    // API key tekshirish
    if (!env.OCR_SPACE_API_KEY) {
      return json({ error: "OCR API key missing on server" }, 500, cors);
    }

    // Form data
    const form = await request.formData();
    const file = form.get("image");
    
    if (!file) {
      return json({ error: "No image provided. Use field name 'image'." }, 400, cors);
    }

    // File size tekshirish (max 8MB)
    const maxBytes = 8 * 1024 * 1024;
    if (typeof file.size === "number" && file.size > maxBytes) {
      return json({ error: "Image too large (max 8MB)" }, 413, cors);
    }

    // MIME type aniqlash
    let mime = (file.type || "").toLowerCase();
    if (!mime.startsWith("image/")) mime = "image/jpeg";
    
    if (!["image/jpeg", "image/jpg", "image/png"].includes(mime)) {
      mime = "image/jpeg";
    }

    // Rasmni base64 ga o'girish
    let base64;
    try {
      const buf = await file.arrayBuffer();
      base64 = arrayBufferToBase64(buf);
    } catch (e) {
      return json(
        { 
          error: "Failed to read uploaded file", 
          details: String(e?.message || e) 
        }, 
        400, 
        cors
      );
    }

    const base64Image = `data:${mime};base64,${base64}`;

    // OCR.space API ga yuborish
    const params = new URLSearchParams();
    params.set("apikey", env.OCR_SPACE_API_KEY);
    params.set("language", "eng");
    params.set("isOverlayRequired", "false");
    params.set("OCREngine", "2");
    params.set("scale", "true");
    params.set("detectOrientation", "true");
    params.set("base64Image", base64Image);

    let ocrJson;
    try {
      const res = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      ocrJson = await res.json();
    } catch (e) {
      return json(
        { 
          error: "OCR request failed", 
          details: String(e?.message || e) 
        }, 
        502, 
        cors
      );
    }

    // OCR xatolik tekshirish
    if (ocrJson?.IsErroredOnProcessing) {
      return json(
        {
          error: "OCR provider error",
          providerMessage: ocrJson?.ErrorMessage || null,
          providerDetails: ocrJson?.ErrorDetails || null,
        },
        502,
        cors
      );
    }

    // Matnni ajratib olish
    const text = String(ocrJson?.ParsedResults?.[0]?.ParsedText || "").trim();
    const words = text ? extractWords(text).slice(0, 100) : [];

    // Tarjima qilish (MyMemory API)
    const pairs = [];
    for (let i = 0; i < words.length; i++) {
      const en = words[i];
      const uz = await myMemoryTranslate(en);
      pairs.push({ en, uz });
      
      // Rate limit uchun kichik kutish
      await sleep(60);
    }

    return json({ text, words, pairs }, 200, cors);
  },
};

// Helper functions
function extractWords(text) {
  const raw = String(text || "").toLowerCase();
  const parts = raw.split(/[\s\n\r\t]+/g);
  const seen = new Set();
  const out = [];
  
  for (const p of parts) {
    const w = normalizeWord(p);
    if (!w || w.length < 3) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  
  return out;
}

function normalizeWord(w) {
  return String(w || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z']/g, "");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000; // 32KB chunks
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  
  return btoa(binary);
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}