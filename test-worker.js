async function test() {
    const url = "https://learncard-ocr.asdovasd446.workers.dev";
    const words = ["has", "range", "intricate", "during", "webs"];
    for (const word of words) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "translate", word })
            });
            const json = await res.json();
            console.log(`Word: ${word} ->`, JSON.stringify(json));
        } catch (e) {
            console.error(`Error for ${word}:`, e);
        }
    }
}
test();
