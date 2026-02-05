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

        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

        if (request.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
        }

        try {
            const body = await request.json();
            const word = (body.word || "").trim();

            if (!word) return json({ translated: "" }, 200, cors);

            // Cache Logic (Gemini V2)
            const cache = caches.default;
            const cacheUrl = new URL(request.url);
            cacheUrl.pathname = `/translate-gemini-v2-robust/${encodeURIComponent(word.toLowerCase())}`;
            const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

            const cachedRes = await cache.match(cacheKey);
            if (cachedRes) return cachedRes;

            // Run Translation via Gemini 2.0
            const translation = await translateWithGemini(word, env.GEMINI_API_KEY);

            const response = json({ translated: translation }, 200, cors);

            if (translation && !translation.startsWith("[")) {
                response.headers.set("Cache-Control", "public, max-age=2592000"); // 30 days
                ctx.waitUntil(cache.put(cacheKey, response.clone()));
            }

            return response;

        } catch (e) {
            return json({ error: String(e.message) }, 500, cors);
        }
    },
};

async function translateWithGemini(text, apiKey) {
    if (!apiKey) return `[Error: Key missing]`;

    // Updated Model List including Lite models for speed/reliability
    const models = [
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite-preview-09-2025",
        "gemini-2.0-flash-lite",
        "gemini-2.5-flash",
        "gemini-1.5-flash",
        "gemini-1.5-pro"
    ];

    // STRICT PROMPT for Dictionary-like quality
    const prompt = `
    You are a professional English-Uzbek dictionary.
    Translate the word or phrase: "${text}" to Uzbek.
    
    Rules:
    1. Output ONLY the translation. No explanations, no "Here is the translation".
    2. If it has multiple meanings, provide the most common/scientific one.
    3. Do NOT transliterate if a proper Uzbek term exists.
    4. Examples:
       "science" -> "fan"
       "cell" -> "hujayra"
       "animals" -> "hayvonlar"
    `;

    // Increased retries to handle 3-4s rate limits
    let globalRetries = 2; // 3 total attempts (Initial + 2 Retries)

    while (globalRetries >= 0) {
        for (const model of models) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                });

                const data = await response.json();

                if (data.error) {
                    // Failover on any error
                    continue;
                }

                const translatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (translatedText) return translatedText.trim();

            } catch (e) {
                // Network error, try next model
            }
        }

        // Global retry logic with backoff
        if (globalRetries > 0) {
            const delay = globalRetries === 2 ? 2000 : 4000; // 2s then 4s wait
            globalRetries--;
            await new Promise(r => setTimeout(r, delay));
        } else {
            break;
        }
    }

    return "[Error: Translation failed - Try again later]";
}

function json(payload, status, cors) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
    });
}
