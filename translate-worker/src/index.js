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

            // Cache Logic (Cloudflare Native Cache)
            const cache = caches.default;
            const cacheUrl = new URL(request.url);
            cacheUrl.pathname = `/translate-v1/${encodeURIComponent(word.toLowerCase())}`;
            const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

            const cachedRes = await cache.match(cacheKey);
            if (cachedRes) return cachedRes;

            // Run Translation via Cloudflare AI (M2M100)
            // This restores the "old" behavior which was reliable and unlimited.
            const response = await runTranslation(word, env.AI);

            // Cache success
            if (response.status === 200) {
                response.headers.set("Cache-Control", "public, max-age=2592000"); // 30 days
                ctx.waitUntil(cache.put(cacheKey, response.clone()));
            }

            return response;

        } catch (e) {
            return json({ error: String(e.message) }, 500, cors);
        }
    },
};

async function runTranslation(text, ai) {
    if (!ai) {
        return json({ error: "AI binding not found. Please check wrangler.toml" }, 500, { "Access-Control-Allow-Origin": "*" });
    }

    try {
        // @cf/meta/m2m100-1.2b is the standard free translation model
        const response = await ai.run('@cf/meta/m2m100-1.2b', {
            text: text,
            source_lang: 'english',
            target_lang: 'uzbek'
        });

        return json({ translated: response.translated_text }, 200, {
            "Access-Control-Allow-Origin": "*"
        });
    } catch (e) {
        return json({ error: `Translation failed: ${e.message}` }, 500, {
            "Access-Control-Allow-Origin": "*"
        });
    }
}

function json(payload, status, headers) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
    });
}
