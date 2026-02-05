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

            // Cache (Eski so'rovlarni xotirada saqlash)
            const cache = caches.default;
            const cacheUrl = new URL(request.url);
            cacheUrl.pathname = `/translate-gemini-v1/${encodeURIComponent(word.toLowerCase())}`;
            const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

            const cachedRes = await cache.match(cacheKey);
            if (cachedRes) return cachedRes;

            // Asosiy tarjima logikasi (Gemini)
            const translation = await translateWithGemini(word, env.GEMINI_API_KEY);

            const response = json({ translated: translation }, 200, cors);

            // Agar tarjima muvaffaqiyatli bo'lsa, uni uzoq muddatga (30 kun) keshga qo'yamiz
            if (translation && !translation.startsWith("[")) {
                response.headers.set("Cache-Control", "public, max-age=2592000");
                ctx.waitUntil(cache.put(cacheKey, response.clone()));
            }

            return response;

        } catch (e) {
            return json({ error: String(e.message) }, 400, cors);
        }
    },
};

async function translateWithGemini(text, apiKey) {
    if (!apiKey) return "[Error: GEMINI_API_KEY not set]";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const prompt = `
    Translate the following text to Uzbek.
    Rules:
    1. Return ONLY the translated text.
    2. Do NOT add explanations or notes.
    3. Do NOT add "o'z" prefix blindly.
    4. If the word has multiple meanings, provide the most common one.
    5. Text to translate: "${text}"
    `;

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
            console.error("Gemini Error:", data.error);
            return `[Error: ${data.error.message}]`;
        }

        const translatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return translatedText ? translatedText.trim() : "[Error: No translation]";

    } catch (e) {
        return `[Error: ${e.message}]`;
    }
}

function json(payload, status, cors) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
    });
}
