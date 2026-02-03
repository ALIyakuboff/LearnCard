
const config = {
    TRANSLATE_WORKER_URLS: {
        beginner: "https://learncard-translate.asdovasd446.workers.dev",
        intermediate: "https://learncard-translate.asdov52.workers.dev",
        ielts: "https://learncard-translate.ziyokor.workers.dev"
    },
    OCR_WORKER_URLS: {
        beginner: "https://learncard-ocr.asdovasd446.workers.dev",
        intermediate: "https://learncard-ocr.asdov52.workers.dev",
        ielts: "https://learncard-ocr.ziyokor.workers.dev"
    }
};

async function testTranslation() {
    const words = ["apple", "freedom", "challenge"];

    for (const level of ["beginner", "intermediate", "ielts"]) {
        console.log(`--- Testing Level: ${level} ---`);
        const translateUrl = config.TRANSLATE_WORKER_URLS[level];
        const ocrUrl = config.OCR_WORKER_URLS[level];

        for (const word of words) {
            // Test Translate Worker
            try {
                const res = await fetch(translateUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ word })
                });
                const data = await res.json();
                console.log(`Translate Worker (${level}) [${word}]:`, JSON.stringify(data));
            } catch (e) {
                console.error(`Translate Worker (${level}) [${word}] Error:`, e.message);
            }

            // Test OCR Worker Fallback
            try {
                const res = await fetch(ocrUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "translate", word })
                });
                const data = await res.json();
                console.log(`OCR Worker Fallback (${level}) [${word}]:`, JSON.stringify(data));
            } catch (e) {
                console.error(`OCR Worker Fallback (${level}) [${word}] Error:`, e.message);
            }
        }
        console.log("\n");
    }
}

testTranslation();
