export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "*";
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
    }

    try {
      const body = await request.json();
      const { image, mimeType, word } = body;

      if (word && !image) {
        return json({ error: "[Error: Wrong Endpoint. You sent text to the OCR (Scanner) worker. Please use the Translate worker.]" }, 400, cors);
      }

      if (!image || !mimeType) {
        return json({ error: "[OCR Error: Image data missing]" }, 400, cors);
      }

      // OCR Logic
      let text;
      try {
        // RATE LIMIT CHECK (KV)
        // 1. Check current usage for today
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const limitKey = `requests_${today}`;

        let currentUsage = 0;
        try {
          const val = await env.OCR_LIMITS.get(limitKey);
          currentUsage = val ? parseInt(val) : 0;
        } catch (kvErr) {
          // Ignore KV errors to avoid blocking service
          console.error("KV Get Error:", kvErr);
        }

        // TIERED LOGIC (NEW - 2026-02-12)
        // 0   - 50 : Gemini 1.5 Pro (Free)
        // 51  +    : Gemini 1.5 Flash (Paid - Cheaper)

        let apiKey = env.GEMINI_API_KEY; // Default to Paid
        let model = "gemini-1.5-flash";  // Default to Flash

        if (currentUsage < 50) {
          // Case 1: 0-50 (Free Pro)
          apiKey = env.GEMINI_API_KEY_FREE;
          model = "gemini-1.5-pro";
        } else {
          // Case 2: 51+ (Paid Flash - 10x Cheaper)
          apiKey = env.GEMINI_API_KEY;
          model = "gemini-1.5-flash";
        }

        // 3. Try Selected Key & Model
        text = await ocrWithGemini(image, mimeType, apiKey, model);

        // 4. Increment usage ONLY if successful
        ctx.waitUntil(env.OCR_LIMITS.put(limitKey, (currentUsage + 1).toString()));

      } catch (e) {
        // 5. Fallback Logic (Only for Paid Pro -> Flash if Pro fails, or Free -> Paid if Free fails?)
        // For now, let's keep it simple: If specific tier fails, we throw. 
        // Complex fallback hierarchies might confuse the billing logic.
        throw e;
      }

      return json({ text }, 200, cors);

    } catch (e) {
      return json({ error: e.message }, 500, cors);
    }
  },
};

async function ocrWithGemini(base64Image, mimeType, apiKey, model = "gemini-1.5-flash") {
  if (!apiKey) throw new Error("API key missing");

  let lastError = "No vision models available";
  let globalRetries = 2; // 3 total attempts

  while (globalRetries >= 0) {
    // Revert to v1beta as v1 is failing for gemini-1.5-flash in some regions/configs
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [{
        parts: [
          {
            text: `
            You are a STRICT OCR engine for English text.
            
            YOUR TASK: Extract the text from the image.
            
            RULES:
            1. ONLY output words that are clearly legible.
            2. DO NOT hallucinate or invent words. If text is blurry or ambiguous, IGNORE it.
            3. Filter out non-word characters and random noise (e.g. "gfliiiiziiiits" is NOT a word).
            4. If words are concatenated (e.g. "isit"), split them ONLY if they form commonly used English words.
            5. Ignore 1-letter words (except "a" and "I").
            
            OUTPUT FORMAT:
            - A clean JSON Array of strings. 
            - Example: ["hello", "world", "this", "is", "text"]
          `},
          { inline_data: { mime_type: mimeType, data: base64Image } }
        ]
      }],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 8192,
      }
    };

    try {
      // Standard fetch to allow immediate failover on error
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...requestBody,
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ]
        })
      });

      const data = await response.json();
      if (data.error) {
        // Failover
        lastError = `${model}: ${data.error.message}`;
        // If 429, maybe breaks loop, but we have global retries
        // throw new Error(lastError); 
      } else {
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          // Clean up potential markdown formatting if Gemini ignores instructions
          const cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
          return cleanText;
        }
      }

    } catch (e) {
      lastError = e.message;
    }

    // Global retry logic with backoff
    if (globalRetries > 0) {
      const delay = globalRetries === 2 ? 2000 : 4000;
      globalRetries--;
      await new Promise(r => setTimeout(r, delay));
      continue; // Restart the model loop
    } else {
      break;
    }
  }

  throw new Error(`Vision models failed: ${lastError}`);
}


function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
