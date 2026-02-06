
const fetch = require('node-fetch'); // Assuming node-fetch or global fetch in newer node
// If node-fetch is not available, we can use https module, but let's try assuming a modern node env or just use standard https

const https = require('https');

const WORKER_URL = "https://learncard-translate.asdovasd446.workers.dev";
const GAS_URL = "https://script.google.com/macros/s/AKfycbwU25xoSCC38egP4KnblHvrW88gwJwi2kLEL9O7DDpsmOONBxd4KRi3EnY9xndBxmcS/exec";

function testWorker() {
    console.log("Testing Worker...");
    const data = JSON.stringify({ word: "hello" });
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    const req = https.request(WORKER_URL, options, (res) => {
        console.log(`Worker Status: ${res.statusCode}`);
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => console.log(`Worker Body: ${body}`));
    });

    req.on('error', (e) => console.error(`Worker Error: ${e.message}`));
    req.write(data);
    req.end();
}

function testGAS() {
    console.log("Testing GAS...");
    const url = `${GAS_URL}?q=hello&source=en&target=uz`;
    https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            console.log(`GAS Redirecting to: ${res.headers.location}`);
            https.get(res.headers.location, (res2) => {
                let body = '';
                res2.on('data', (chunk) => body += chunk);
                res2.on('end', () => console.log(`GAS Body: ${body}`));
            });
            return;
        }
        console.log(`GAS Status: ${res.statusCode}`);
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => console.log(`GAS Body: ${body}`));
    }).on('error', (e) => console.error(`GAS Error: ${e.message}`));
}

testWorker();
testGAS();
