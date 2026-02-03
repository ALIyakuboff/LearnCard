
async function checkUrl() {
    const url = "https://learncard-translate.asdovasd446.workers.dev";
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ word: "test" })
        });
        console.log("Status:", res.status);
        console.log("Headers:", JSON.stringify(Object.fromEntries(res.headers.entries())));
        const text = await res.text();
        console.log("Body (first 500 chars):", text.slice(0, 500));
    } catch (e) {
        console.error("Fetch failed:", e);
    }
}
checkUrl();
