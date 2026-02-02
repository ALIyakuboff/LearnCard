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

        // Tarjima faqat POST orqali
        if (request.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
        }

        try {
            const body = await request.json();
            const word = (body.word || "").toLowerCase().trim();

            if (!word) return json({ translated: "" }, 200, cors);

            // Cache (Eski so'rovlarni xotirada saqlash)
            const cache = caches.default;
            const cacheUrl = new URL(request.url);
            cacheUrl.pathname = `/translate-v1/${encodeURIComponent(word)}`;
            const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

            const cachedRes = await cache.match(cacheKey);
            if (cachedRes) return cachedRes;

            // Asosiy tarjima logikasi
            const translation = await translateWord(word, env.AI);

            const response = json({ translated: translation }, 200, cors);

            // Agar tarjima muvaffaqiyatli bo'lsa, uni 1 haftaga keshga qo'yamiz
            if (translation && !translation.startsWith("[")) {
                response.headers.set("Cache-Control", "public, max-age=604800");
                ctx.waitUntil(cache.put(cacheKey, response.clone()));
            }

            return response;

        } catch (e) {
            return json({ error: String(e.message) }, 400, cors);
        }
    },
};

async function translateWord(word, ai) {
    // 1. Google Translate (Direct undocumented API)
    const domains = ["translate.googleapis.com", "clients1.google.com", "clients5.google.com"];
    const agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
    ];

    for (const domain of domains) {
        const url = `https://${domain}/translate_a/single?client=gtx&sl=en&tl=uz&dt=t&q=${encodeURIComponent(word)}`;
        try {
            const res = await fetch(url, {
                headers: { "User-Agent": agents[Math.floor(Math.random() * agents.length)] },
                cf: { cacheTtl: 86400 }
            });
            if (res.ok) {
                const data = await res.json();
                const t = data?.[0]?.[0]?.[0];
                if (t) return t;
            }
        } catch (e) { }
    }

    // 2. Fallback: Cloudflare Workers AI
    if (ai) {
        try {
            const response = await ai.run("@cf/meta/m2m100-1.2b", {
                text: word,
                source_lang: "en",
                target_lang: "uz"
            });
            if (response && response.translated_text) {
                return response.translated_text;
            }
        } catch (e) { }
    }

    return "[Xatolik: 429]";
}

function json(payload, status, cors) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
    });
}
