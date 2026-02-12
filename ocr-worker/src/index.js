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

        // 2. If limit reached, Force Fallback (simulate quota error)
        if (currentUsage >= 5000) {
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
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
  ];

  let lastError = "No vision models available";
  let globalRetries = 2; // 3 total attempts

  while (globalRetries >= 0) {

    for (const model of models) {
      // Revert to v1beta as v1 is failing for gemini-1.5-flash in some regions/configs
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [{
          parts: [
            {
              text: `
              Analyze this image and extract all legible English words.

              Strict Guidelines:
              1. Output ONLY a valid JSON Array of strings. Example: ["word1", "word2", "word3"]
              2. DO NOT include any markdown formatting. Just the raw JSON array.
              3. **CRITICAL:** Ignore words that are cut off at the edges of the image or partially visible.
              4. **CRITICAL:** Ignore random letters, noise, or blurry text that is not a clear English word.
              5. **CRITICAL:** DO NOT concatenate short words. "is it" must be ["is", "it"], NOT ["isit"].
              6. Treat 2-letter words (is, am, to, in, at, on) as valid words if they are clear.
              7. Correct obvious OCR errors (e.g. '1' for 'l', '0' for 'O') based on English context.
              8. Ignore non-text elements, UI icons, page numbers, headers, footers.
              9. Convert all text to lowercase.
              10. Do not include punctuation within words unless part of the word (like "don't").
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
          continue;
        }

        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          // Clean up potential markdown formatting if Gemini ignores instructions
          const cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
          return cleanText;
        }

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
