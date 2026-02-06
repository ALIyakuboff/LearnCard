const https = require('https');

const WORKER_URL = "https://learncard-translate.asdovasd446.workers.dev"; // Adjust if needed

async function testBatch() {
    console.log("Testing Worker Batch Translation for Errors...");

    // Use a nonsense word to force fallback? Or just random to hit cache miss.
    // To trigger GAS error, we might need a word that GAS fails on, or just stress it.
    // "sdlkfjsdlkfj" usually translates to itself or fails.

    const words1 = ["xgames_test_1", "xgames_test_2"];

    await sendBatch(words1);
}

function sendBatch(words) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ words: words });
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = https.request(WORKER_URL, options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                console.log(`Response Status: ${res.statusCode}`);
                console.log(`Response Body Preview: ${body.substring(0, 300)}...`);
                if (body.includes("[Error: Failed to translate -")) {
                    console.log("SUCCESS: Captured detailed error message!");
                } else if (body.includes("xgames_test")) {
                    console.log("NOTE: Translation somehow succeeded (or echoed).");
                }
                resolve(body);
            });
        });

        req.on('error', (e) => {
            console.error(`Error: ${e.message}`);
            resolve(null);
        });
        req.write(data);
        req.end();
    });
}

testBatch();
