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

            const IGNORED_WORDS = new Set(["was", "were"]);

            // BATCH MODE
            if (body.words && Array.isArray(body.words)) {
                const words = body.words
                    .filter(w => w && typeof w === 'string')
                    .map(w => w.trim())
                    .filter(w => !IGNORED_WORDS.has(w.toLowerCase()))
                    .slice(0, 50); // Limit batch size

                if (!words.length) return json({ translated: {} }, 200, cors);

                const translations = await translateBatchWithGemini(words, env.GEMINI_API_KEY);
                return json({ translated: translations }, 200, cors);
            }

            // SINGLE MODE (Legacy support)
            const word = (body.word || "").trim();
            if (!word || IGNORED_WORDS.has(word.toLowerCase())) return json({ translated: "" }, 200, cors);

            // Cache Logic (Gemini V2) - Only for single words for now
            const cache = caches.default;
            const cacheUrl = new URL(request.url);
            cacheUrl.pathname = `/translate-gemini-v2-robust/${encodeURIComponent(word.toLowerCase())}`;
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

async function translateBatchWithGemini(words, apiKey) {
    if (!apiKey) return {};

    // Batch Prompt
    const prompt = `
    You are a professional English-Uzbek dictionary.
    Translate the following list of words to Uzbek.
    Return ONLY a valid JSON object where keys are the English words and values are the Uzbek translations.
    
    Words to translate:
    ${JSON.stringify(words)}

    Rules:
    1. Output strictly valid JSON. No markdown code blocks (like \`\`\`json).
    2. No explanations.
    3. If a word has multiple meanings, choose the most common/scientific one.
    4. Example output format: { "apple": "olma", "run": "yugurmoq" }
    `;

    const models = ["gemini-2.0-flash", "gemini-1.5-flash"];

    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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

            try {
                const jsonMap = JSON.parse(text);
                return jsonMap;
            } catch (jsonErr) {
                console.error(`Batch JSON Parse Error (${model}):`, text);
                continue; // Try next model if JSON is bad
            }

        } catch (e) {
            console.error(`Batch Error (${model}):`, e.message);
        }
    }

    // Fallback: Return empty object or error indicators? 
    // For batch, let's return partials or empty so frontend can fallback/retry if needed?
    // Actually, let's return a map where all values are error messages if it fails completely.
    const failureMap = {};
    for (const w of words) failureMap[w] = "[Error: Batch Failed]";
    return failureMap;
}


async function translateWithGemini(text, apiKey) {
    if (!apiKey) return `[Error: Key missing]`;

    // Updated Model List including Lite models for speed/reliability
    const models = [
        "gemini-2.0-flash",
        "gemini-1.5-flash"
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
    let lastError = "Unknown error";

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

    // If all Gemini models fail, try GAS Fallback (Server-to-Server, no CORS)
    try {
        const gasUrl = "https://script.google.com/macros/s/AKfycbwU25xoSCC38egP4KnblHvrW88gwJwi2kLEL9O7DDpsmOONBxd4KRi3EnY9xndBxmcS/exec";
        const params = new URLSearchParams({ q: text, source: "en", target: "uz" });
        const gasRes = await fetch(`${gasUrl}?${params}`, {
            method: "GET",
            headers: { "User-Agent": "Mozilla/5.0 (Worker)" },
            redirect: "follow"
        });

        if (!gasRes.ok) {
            lastError += ` | GAS HTTP Error: ${gasRes.status}`;
        } else {
            const textBody = await gasRes.text();
            try {
                const gasData = JSON.parse(textBody);
                // Support both standard and simplified format
                const translatedText = gasData.translatedText || gasData.translated;
                if (translatedText) {
                    return translatedText;
                } else {
                    lastError += ` | GAS Invalid JSON: ${textBody.substring(0, 50)}...`;
                }
            } catch (jsonErr) {
                lastError += ` | GAS Parse Error: ${jsonErr.message} Body: ${textBody.substring(0, 50)}...`;
            }
        }
    } catch (e) {
        lastError += ` | GAS Error: ${e.message}`;
    }

    return `[Error: All models & Fallback failed. Last: ${lastError}]`;
}

function json(payload, status, cors) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
    });
}
