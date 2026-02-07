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

        const url = new URL(request.url);

        if (url.pathname === "/translate" || url.pathname === "/") { // Assuming / or /translate is for the main translation logic
            if (request.method !== "POST") {
                return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
            }
        } else {
            return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: cors });
        }

        try {
            const body = await request.json();

            const IGNORED_WORDS = new Set(["was", "were"]);

            // BATCH MODE
            if (body.words && Array.isArray(body.words)) {
                const words = body.words
                    .filter(w => w && typeof w === 'string')
                    .map(w => w.trim())
                    .filter(w => !IGNORED_WORDS.has(w.toLowerCase()))
                    .slice(0, 1000); // Increased limit from 50 to 1000

                if (!words.length) return json({ translated: {} }, 200, cors);

                // Pass ctx and request for caching
                const translations = await translateBatchWithGemini(words, env.GEMINI_API_KEY, ctx, request);
                return json({ translated: translations }, 200, cors);
            }

            // SINGLE MODE (Legacy support)
            const word = (body.word || "").trim();
            if (!word || IGNORED_WORDS.has(word.toLowerCase())) return json({ translated: "" }, 200, cors);

            // Cache Logic (Gemini V2) - Only for single words for now
            const cache = caches.default;
            const cacheUrl = new URL(request.url);
            cacheUrl.pathname = `/translate-gemini-v4-debug/${encodeURIComponent(word.toLowerCase())}`;
            const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

            const cachedRes = await cache.match(cacheKey);
            if (cachedRes) return cachedRes;

            const translation = await translateWithGemini(word, env.GEMINI_API_KEY);
            const response = json({ translated: translation }, 200, cors);

            if (translation && !translation.startsWith("[")) {
                response.headers.set("Cache-Control", "public, max-age=2592000"); // 30 days
                ctx.waitUntil(cache.put(cacheKey, response.clone()));
            }

            return response;

        } catch (e) {
            return json({ translated: `[Error: Worker Crash - ${e.message}]` }, 200, cors);
        }
    },
};

async function translateBatchWithGemini(words, apiKey, ctx, request) {
    if (!apiKey) return {};

    const results = {};
    const missingWords = [];
    const cache = caches.default;
    const origin = new URL(request.url).origin; // Use current origin for cache keys

    // 1. Try to fetch from Cache first (Parallel)
    await Promise.all(words.map(async (word) => {
        try {
            const cacheId = encodeURIComponent(word.toLowerCase());
            const cacheUrl = new URL(`/translate-gemini-v4-debug/${cacheId}`, origin).toString();
            // Create a consistent cache key
            const cacheKey = new Request(cacheUrl, { method: "GET" });

            const cachedRes = await cache.match(cacheKey);
            if (cachedRes) {
                const data = await cachedRes.json();
                if (data.translated) {
                    results[word] = data.translated;
                    return;
                }
            }
        } catch (e) {
            // Ignore cache errors, proceed to fetch
        }
        missingWords.push(word);
    }));

    if (missingWords.length === 0) {
        return results;
    }

    // 2. Fetch missing words from Gemini
    // Batch Prompt for missing words only
    const prompt = `
    You are a professional English-Uzbek dictionary.
    Translate the following list of words to Uzbek.
    Return ONLY a valid JSON object where keys are the English words and values are the Uzbek translations.
    
    Words to translate:
    ${JSON.stringify(missingWords)}

    Rules:
    1. Output strictly valid JSON. No markdown code blocks.
    2. No explanations.
    3. IMPORTANT: If a word has multiple meanings (e.g. noun vs verb, or different concepts), you MUST provide 1 to 3 distinct meanings, separated by commas.
    4. Example output: { "apple": "olma", "right": "o'ng, to'g'ri, huquq", "bank": "bank, qirg'oq" }
    `;

    const models = ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro"];
    let fetchedTranslations = null;

    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error.message);

            let text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) continue;

            // Clean markdown if present
            text = text.replace(/```json/g, "").replace(/```/g, "").trim();
            fetchedTranslations = JSON.parse(text);
            break; // Success

        } catch (e) {
            console.error(`Batch Error (${model}):`, e.message);
        }
    }

    // 3. Process results and Update Cache
    if (fetchedTranslations) {
        Object.assign(results, fetchedTranslations);

        // Store NEW translations in cache individually
        // This allows them to be hit by single-word requests later too!
        for (const [word, translation] of Object.entries(fetchedTranslations)) {
            try {
                if (translation && typeof translation === 'string' && !translation.startsWith("[")) {
                    const cacheId = encodeURIComponent(word.toLowerCase());
                    const cacheUrl = new URL(`/translate-gemini-v4-debug/${cacheId}`, origin).toString();
                    const cacheKey = new Request(cacheUrl, { method: "GET" });

                    const responseToCache = new Response(JSON.stringify({ translated: translation }), {
                        status: 200,
                        headers: {
                            "Content-Type": "application/json",
                            "Cache-Control": "public, max-age=2592000" // 30 days
                        }
                    });

                    ctx.waitUntil(cache.put(cacheKey, responseToCache));
                }
            } catch (e) {
                console.error("Cache Put Error:", e);
            }
        }
    } else {
        // Fallback: Try single word GAS logic for remaining missing words
        // SAFETY: Only try fallback if we have enough subrequests left!
        // GAS uses 2 subrequests per word. Limit is 50. 
        if (missingWords.length > 15) {
            for (const w of missingWords) {
                results[w] = `[Error: Rate Limit - Too many words to fallback (${missingWords.length}). Retry this part.]`;
            }
            return results;
        }

        for (const w of missingWords) {
            const gasRes = await translateWithGas(w);
            if (gasRes.success) {
                results[w] = gasRes.text;
                // Optional: Cache GAS results too? Yes.
                try {
                    const cacheId = encodeURIComponent(w.toLowerCase());
                    const cacheUrl = new URL(`/translate-gemini-v4-debug/${cacheId}`, origin).toString();
                    const cacheKey = new Request(cacheUrl, { method: "GET" });
                    const responseToCache = new Response(JSON.stringify({ translated: gasRes.text }), {
                        status: 200,
                        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" } // 1 day for fallback
                    });
                    ctx.waitUntil(cache.put(cacheKey, responseToCache));
                } catch (e) { }
            } else {
                // Expose the error detail for debugging
                results[w] = `[Error: Failed to translate - ${gasRes.error || "Unknown"}]`;
            }
        }
    }

    return results;
}


async function translateWithGemini(text, apiKey) {
    if (!apiKey) return `[Error: Key missing]`;

    // Updated Model List including Lite models for speed/reliability
    const models = [
        "gemini-2.0-flash",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
        "gemini-pro"
    ];

    // STRICT PROMPT for Dictionary-like quality
    const prompt = `
    You are a professional English-Uzbek dictionary.
    Translate the word or phrase: "${text}" to Uzbek.
    
    Rules:
    Rules:
    1. Output ONLY the translation. No explanations.
    2. IMPORTANT: If a word has multiple meanings (e.g. noun vs verb), you MUST provide 1 to 3 distinct meanings, separated by commas.
    3. Examples:
       "science" -> "fan"
       "right" -> "o'ng, to'g'ri, huquq"
       "bank" -> "bank, qirg'oq"
       "science" -> "fan"
       "right" -> "o'ng, to'g'ri, huquq"
    `;

    // Increased retries to handle 3-4s rate limits
    let globalRetries = 2; // 3 total attempts (Initial + 2 Retries)
    let lastError = "Unknown error";

    while (globalRetries >= 0) {
        for (const model of models) {
            const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

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
                    lastError = `${model}: ${data.error.message || JSON.stringify(data.error)}`;
                    console.error("Gemini Error:", lastError);
                    continue;
                }

                const translatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (translatedText) return translatedText.trim();

            } catch (e) {
                lastError = `${model}: ${e.message}`;
                // Network error, try next model
            }
        }

        // Global retry logic with backoff
        if (globalRetries > 0) {
            const delay = globalRetries === 2 ? 500 : 1000; // 0.5s then 1s wait
            globalRetries--;
            await new Promise(r => setTimeout(r, delay));
        } else {
            break;
        }
    }

    // If all Gemini models fail, try GAS Fallback
    const gasResult = await translateWithGas(text);
    if (gasResult.success) return `${gasResult.text} [Gemini Error: ${lastError}]`;

    lastError += ` | ${gasResult.error}`;
    return `[Error: All models & Fallback failed. Last: ${lastError}]`;
}

async function translateWithGas(text) {
    try {
        const gasUrl = "https://script.google.com/macros/s/AKfycbwU25xoSCC38egP4KnblHvrW88gwJwi2kLEL9O7DDpsmOONBxd4KRi3EnY9xndBxmcS/exec";
        const params = new URLSearchParams({ q: text, source: "en", target: "uz" });
        const gasRes = await fetch(`${gasUrl}?${params}`, {
            method: "GET",
            headers: { "User-Agent": "Mozilla/5.0 (Worker)" },
            redirect: "follow"
        });

        if (!gasRes.ok) {
            return { success: false, error: `GAS HTTP Error: ${gasRes.status}` };
        }

        const textBody = await gasRes.text();
        try {
            const gasData = JSON.parse(textBody);
            const translatedText = gasData.translatedText || gasData.translated;
            if (translatedText) return { success: true, text: translatedText };
            return { success: false, error: `GAS Invalid JSON: ${textBody.substring(0, 50)}...` };
        } catch (jsonErr) {
            return { success: false, error: `GAS Parse Error: ${jsonErr.message}` };
        }
    } catch (e) {
        return { success: false, error: `GAS Error: ${e.message}` };
    }
}

function json(payload, status, cors) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
    });
}
