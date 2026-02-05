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
      const text = await ocrWithGemini(image, mimeType, env.GEMINI_API_KEY);

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
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite-preview-09-2025",
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash",
    "gemini-exp-1206",
    "gemini-1.5-flash",
    "gemini-1.5-pro"
  ];

  let lastError = "No vision models available";
  let globalRetries = 2; // 3 total attempts

  while (globalRetries >= 0) {

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
