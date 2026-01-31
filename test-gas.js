async function testGas() {
    const gasUrl = "https://script.google.com/macros/s/AKfycbwU25xoSCC38egP4KnblHvrW88gwJwi2kLEL9O7DDpsmOONBxd4KRi3EnY9xndBxmcS/exec";
    const word = "has";
    try {
        const url = `${gasUrl}?q=${encodeURIComponent(word)}&sl=en&tl=uz`;
        console.log("Fetching GAS:", url);
        const res = await fetch(url);
        const text = await res.text();
        console.log("GAS Result:", text);
    } catch (e) {
        console.error("GAS Error:", e);
    }
}
testGas();
