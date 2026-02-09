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

        // 2. If limit reached, Force Fallback (simulate quota error)
        if (currentUsage >= 4000) {
          throw new Error("429 Quota Exceeded (Internal Limit)");
        }

        // 3. Try Primary (Paid) Key
        text = await ocrWithGemini(image, mimeType, env.GEMINI_API_KEY);

        // 4. Increment usage ONLY if successful
        ctx.waitUntil(env.OCR_LIMITS.put(limitKey, (currentUsage + 1).toString()));

      } catch (e) {
        // 5. Check for Quota/Rate Limit Errors (Google or Internal)
        const isQuotaError = e.message.includes("429") ||
          e.message.includes("Quota") ||
          e.message.includes("Resource has been exhausted");

        if (isQuotaError && env.GEMINI_API_KEY_FREE) {
          console.log("Primary Key Quota Exceeded. Switching to Free Key...");
          // 6. Retry with Secondary (Free) Key
          text = await ocrWithGemini(image, mimeType, env.GEMINI_API_KEY_FREE);
          text += " [Free Tier Backup]"; // Optional marker
        } else {
          throw e; // Re-throw if it's not a quota error or no free key
        }
      }

      return json({ text }, 200, cors);

    } catch (e) {
      return json({ error: e.message }, 500, cors);
    }
  },
};

async function ocrWithGemini(base64Image, mimeType, apiKey) {
  if (!apiKey) throw new Error("API key missing");

  // Vision models only (gemini-pro does not support images)
  const models = [
    "gemini-1.5-flash", // Primary: Fast & Cheap
  ];

  let lastError = "No vision models available";
  let globalRetries = 2; // 3 total attempts

  while (globalRetries >= 0) {

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [{
          parts: [
            {
              text: `
              Analyze this image and extract all legible English words.

              Strict Guidelines:
              1. Output ONLY the words, separated by spaces or newlines.
              2. DO NOT concatenate words. Keep them separate even if they are close (e.g. "hello world", NOT "helloworld").
              3. Prioritize separating words over fixing spelling. Do not merge words to "fix" them.
              4. Ignore non-text elements, UI icons, page numbers, headers, footers, or battery/time indicators.
              5. If text is cut off or illegible, ignore it.
              6. Do not include punctuation like periods or commas.
              7. Convert all text to lowercase.
            `},
            { inline_data: { mime_type: mimeType, data: base64Image } }
          ]
        }]
      };

      try {
        // Standard fetch to allow immediate failover on error
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        if (data.error) {
          // Failover
          lastError = `${model}: ${data.error.message}`;
          continue;
        }

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text.trim();

      } catch (e) {
        lastError = e.message;
      }
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
