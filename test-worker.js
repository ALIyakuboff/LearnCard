async function test() {
    const url = "https://learncard-ocr.asdovasd446.workers.dev";
    const payload = { action: "translate", word: "cat" };
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        console.log("Response:", JSON.stringify(json, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
}
test();
