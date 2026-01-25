// Cloudflare Worker — OCR + Translation (E301 xatolik tuzatilgan)
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

    if (!env.OCR_SPACE_API_KEY) {
      return json({ error: "OCR API key missing on server" }, 500, cors);
    }

    const form = await request.formData();
    const file = form.get("image");
    
    if (!file) {
      return json({ error: "No image provided. Use field name 'image'." }, 400, cors);
    }

    const maxBytes = 8 * 1024 * 1024;
    if (typeof file.size === "number" && file.size > maxBytes) {
      return json({ error: "Image too large (max 8MB)" }, 413, cors);
    }

    // ✅ YAXSHILANGAN: Rasm tipini tekshirish
    let mime = (file.type || "").toLowerCase();
    
    // Faqat JPG va PNG qabul qilish
    if (!["image/jpeg", "image/jpg", "image/png"].includes(mime)) {
      return json({ 
        error: "Unsupported image format. Only JPG and PNG allowed.", 
        receivedType: mime 
      }, 400, cors);
    }

    // ✅ YAXSHILANGAN: ArrayBuffer → Uint8Array → base64
    let base64;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Chunked conversion for large files
      let binary = '';
      const chunkSize = 32768; // 32KB chunks
      
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
        binary += String.fromCharCode.apply(null, chunk);
      }
      
      base64 = btoa(binary);
      
    } catch (e) {
      return json(
        { 
          error: "Failed to encode image", 
          details: String(e?.message || e) 
        }, 
        400, 
        cors
      );
    }

    // ✅ YAXSHILANGAN: OCR.space uchun to'g'ri format
    // Base64 prefix: faqat image/jpeg yoki image/png
    const mimeType = mime === "image/png" ? "image/png" : "image/jpeg";
    const base64Image = `data:${mimeType};base64,${base64}`;

    // ✅ YAXSHILANGAN: OCR.space API params
    const params = new URLSearchParams();
    params.set("apikey", env.OCR_SPACE_API_KEY);
    params.set("language", "eng");
    params.set("isOverlayRequired", "false");
    params.set("OCREngine", "2"); // Engine 2 is more accurate
    params.set("scale", "true");
    params.set("detectOrientation", "true");
    params.set("base64Image", base64Image);

    // ✅ YAXSHILANGAN: 2 marta retry with delay
    let ocrJson;
    let lastError = null;
    
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch("https://api.ocr.space/parse/image", {
          method: "POST",
          headers: { 
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "LearnCard/1.0"
          },
          body: params.toString(),
        });
        
        ocrJson = await res.json();
        
        // Agar muvaffaqiyatli bo'lsa, loop'dan chiqamiz
        if (!ocrJson?.IsErroredOnProcessing) {
          lastError = null;
          break;
        }
        
        // E301 xatolik - retry qilamiz
        const errMsg = ocrJson?.ErrorMessage || "";
        if (errMsg.includes("E301") && attempt === 1) {
          lastError = errMsg;
          await sleep(800); // 800ms kutamiz
          continue;
        }
        
        // Boshqa xatolik - loop'dan chiqamiz
        lastError = errMsg;
        break;
        
      } catch (e) {
        lastError = String(e?.message || e);
        if (attempt === 1) {
          await sleep(800);
          continue;
        }
        break;
      }
    }

    // Xatolik tekshirish
    if (lastError || ocrJson?.IsErroredOnProcessing) {
      return json(
        {
          error: "OCR provider error",
          providerMessage: ocrJson?.ErrorMessage || lastError || "Unknown error",
          providerDetails: ocrJson?.ErrorDetails || null,
          suggestion: "Try: 1) Take screenshot instead of photo, 2) Ensure good lighting, 3) Use PNG format"
        },
        502,
        cors
      );
    }

    // ✅ Matnni ajratib olish
    const text = String(ocrJson?.ParsedResults?.[0]?.ParsedText || "").trim();
    
    if (!text) {
      return json({
        error: "No text found in image",
        suggestion: "Make sure image contains clear, readable text"
      }, 400, cors);
    }
    
    const words = extractWords(text).slice(0, 100);

    // ✅ Tarjima qilish (parallel for speed)
    const pairs = [];
    const translations = await Promise.all(
      words.map(word => myMemoryTranslate(word))
    );
    
    for (let i = 0; i < words.length; i++) {
      pairs.push({ 
        en: words[i], 
        uz: translations[i] 
      });
    }

    return json({ 
      text, 
      words, 
      pairs,
      ocrEngine: "OCR.space Engine 2"
    }, 200, cors);
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

async function myMemoryTranslate(word) {
  const q = encodeURIComponent(word);
  const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|uz`;
  
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "LearnCard/1.0" }
    });
    
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