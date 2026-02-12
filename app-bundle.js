document.addEventListener("DOMContentLoaded", () => {
  // CONFIG: LocalStorage mode with Auth requirement
  const cfg = window.APP_CONFIG || {};
  const activeWorkerUrl = cfg.OCR_WORKER_URL || "";
  const activeTranslateUrl = cfg.TRANSLATE_WORKER_URL || "";

  const GAS_TRANSLATE_URL = cfg.GAS_TRANSLATE_URL || "";

  const el = (id) => document.getElementById(id);
  const setText = (node, text) => { if (node) node.textContent = text ?? ""; };
  const safeTrim = (s) => (s || "").trim();

  const imageInput = el("imageInput");
  const runOcrBtn = el("runOcrBtn");
  const clearScanBtn = el("clearScanBtn");
  const ocrStatus = el("ocrStatus");

  const ocrUx = el("ocrUx");
  const ocrProgressBar = el("ocrProgressBar");
  const ocrProgressText = el("ocrProgressText");

  const wordsChips = el("wordsChips");
  const manualWord = el("manualWord");
  const addManualWordBtn = el("addManualWordBtn");

  const chatTitle = el("chatTitle");
  const createChatBtn = el("createChatBtn");
  const createStatus = el("createStatus");
  const chatList = el("chatList");

  const activeChatTitle = el("activeChatTitle");
  const activeChatMeta = el("activeChatMeta");
  const card = el("card");
  const cardFront = el("cardFront");
  const cardBack = el("cardBack");
  const frontText = el("frontText");
  const backText = el("backText");
  const exampleText = el("exampleText");
  const prevBtn = el("prevBtn");
  const nextBtn = el("nextBtn");
  const speakBtn = el("speakBtn");
  const speakBtnBack = el("speakBtnBack");
  const cardsList = el("cardsList"); // New separate container

  // TEST CARD ELEMENTS
  const testCard = el("testCard");
  const testQuestionWord = el("testQuestionWord");
  const testOptions = el("testOptions");
  const testPrevBtn = el("testPrevBtn");
  const testNextBtn = el("testNextBtn");
  let testCardIndex = 0;

  function setOcrStatus(msg) { setText(ocrStatus, msg); }
  function setCreateStatus(msg) { setText(createStatus, msg); }

  function ocrUxShow() {
    if (!ocrUx) return;
    ocrUx.classList.remove("hidden");
    if (ocrProgressBar) ocrProgressBar.style.width = "0%";
    if (ocrProgressText) ocrProgressText.textContent = "";
  }
  function ocrUxHide() { if (ocrUx) ocrUx.classList.add("hidden"); }
  function ocrUxSetProgress(pct, text) {
    const p = Math.max(0, Math.min(100, pct));
    if (ocrProgressBar) ocrProgressBar.style.width = `${p}%`;
    if (ocrProgressText) ocrProgressText.textContent = "";
  }

  let extractedWords = [];
  let translationMap = new Map();

  let chats = [];
  let activeChat = null;
  let activeCards = [];
  let cardIndex = 0;

  function normalizeWord(w) {
    return (w || "").trim().toLowerCase().replace(/[^a-z']/g, "");
  }

  const STOP_WORDS = new Set([
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
    "this", "but", "his", "by", "from", "they", "we", "say", "her", "she", "or", "an", "will", "my", "one", "all", "would", "there",
    "their", "what", "so", "up", "out", "if", "about", "who", "get", "which", "go", "me", "when", "make", "can", "like", "time", "no",
    "just", "him", "know", "take", "people", "into", "year", "your", "good", "some", "could", "them", "see", "other", "than", "then",
    "now", "look", "only", "come", "its", "over", "think", "also", "back", "after", "use", "two", "how", "our", "work", "first", "well",
    "way", "even", "new", "want", "because", "any", "these", "give", "day", "most", "us", "are",
    "isn't", "aren't", "doesn't", "don't", "won't", "didn't"
  ]);

  function extractWordsFromText(text) {
    const raw = (text || "").toLowerCase();
    // Improved splitting: split by whitespace AND punctuation (comma, dot, etc.)
    // This fixes "hello,world" becoming "helloworld"
    const parts = raw.split(/[\s,.;:()!?"'\[\]]+/g);
    const seen = new Set();
    const out = [];
    for (const p of parts) {
      const w = normalizeWord(p);
      if (!w) continue;
      if (w.length < 2) continue; // Allow 2 letter words like "is", "am"
      if (STOP_WORDS.has(w)) continue; // Filter stop words
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }
    return out;
  }

  // PREPROCESSING FOR BETTER OCR
  async function preprocessImageForOcr(imageFile) {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);
    try {
      await new Promise((resolve) => { img.onload = resolve; img.src = url; });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Grayscale & Binarization (Thresholding)
      // Simple threshold to boost contrast for text
      const threshold = 128;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Grayscale (luminance)
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // Binarize (Black or White) - "High Contrast"
        // If it's light, make it white. If dark, make it black.
        // Adding a slight "gamma" or dynamic adjustment could be better, but simple threshold works well for clear text.
        const val = gray > 140 ? 255 : 0; // 140 is a bit safer than 128 for shadows

        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }

      ctx.putImageData(imageData, 0, 0);

      return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function toSafeImageFile(originalFile, maxSide = 1200, jpegQuality = 0.9) { // Increased quality default
    const img = new Image();
    const url = URL.createObjectURL(originalFile);
    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const nw = Math.round(w * scale);
      const nh = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, nw, nh);
      const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", jpegQuality));
      if (jpegBlob) return new File([jpegBlob], "ocr.jpg", { type: "image/jpeg" });
      return originalFile;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function renderWords() {
    if (!wordsChips) return;
    if (!extractedWords.length) {
      wordsChips.textContent = "Hozircha so‘z yo‘q.";
      wordsChips.classList.add("muted");
      return;
    }
    wordsChips.classList.remove("muted");
    wordsChips.innerHTML = "";
    extractedWords.forEach((w) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      const trans = translationMap.get(w);
      chip.textContent = w;
      chip.title = "Bosib olib tashlang";
      chip.addEventListener("click", () => {
        extractedWords = extractedWords.filter((x) => x !== w);
        translationMap.delete(w);
        renderWords();
      });
      wordsChips.appendChild(chip);
    });
  }

  async function runServerOcr(file) {
    try {
      if (!activeWorkerUrl) throw new Error("Server OCR URL not configured");

      ocrUxShow();
      ocrUxSetProgress(10, "Serverga yuklanmoqda...");

      // Resize to reasonable size for API (max 1024x1024 is usually good for speed/cost, but 1500 is fine)
      // optimization: Increased to 2000px and 0.95 quality for better photo OCR
      const safeFile = await toSafeImageFile(file, 2000, 0.95);

      const arrayBuffer = await safeFile.arrayBuffer();
      const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

      ocrUxSetProgress(40, "Sun'iy intellekt tahlil qilmoqda...");

      const res = await fetch(activeWorkerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: base64,
          mimeType: safeFile.type || "image/jpeg"
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `Server Error ${res.status}`);
      }

      // Check for JSON array in text field (since we updated worker to return stringified JSON)
      if (data.text) {
        try {
          // Try parsing if it looks like JSON
          if (data.text.trim().startsWith('[') && data.text.trim().endsWith(']')) {
            const words = JSON.parse(data.text);
            if (Array.isArray(words)) {
              return words.join(" "); // Return joined string for consistent processing downstream
            }
          }
        } catch (e) {
          console.warn("Could not parse JSON from OCR, using raw text", e);
        }

        if (data.text.length < 2) {
          throw new Error("Server topilmadi");
        }
        return data.text;
      }

      throw new Error("Server topilmadi");

    } catch (e) {
      console.warn("Server OCR Failed, switching to Client:", e);
      return null; // Signal failure to fallback
    }
  }

  async function runClientOcr(file) {
    if (!file) return;
    try {
      ocrUxShow();
      setOcrStatus("");

      // 1. Try Server OCR First
      const serverText = await runServerOcr(file);

      let text = serverText;

      // 2. Fallback to Tesseract if Server failed
      if (!text) {
        ocrUxSetProgress(10, "Server ishlamadi. Telefon skaneri ishga tushmoqda...");

        let safeFile = await toSafeImageFile(file, 1500, 0.95);
        const processedBlob = await preprocessImageForOcr(safeFile);
        const processedFile = new File([processedBlob], "processed.jpg", { type: "image/jpeg" });

        ocrUxSetProgress(30, "Matn o‘qilmoqda (Tesseract)...");

        const worker = await Tesseract.createWorker('eng', 1, {
          logger: m => {
            if (m.status === 'recognizing text') {
              ocrUxSetProgress(30 + Math.round(m.progress * 60), `Skanerlash: ${Math.round(m.progress * 100)}%`);
            }
          }
        });

        const { data: { text: tesseractText } } = await worker.recognize(processedFile);
        await worker.terminate();
        text = tesseractText;
      }

      if (!text || text.trim().length < 2) {
        setOcrStatus("⚠️ Matn topilmadi. Boshqa rasm bilan ko'ring.");
        ocrUxSetProgress(0, "No text found");
        return;
      }

      console.log("OCR Result:", text);
      const words = extractWordsFromText(text);
      extractedWords = words.map(normalizeWord).filter(Boolean);

      translationMap = new Map();
      renderWords();
      setOcrStatus(`Muvaffaqiyatli: ${extractedWords.length} ta so'z ajratildi.`);
      ocrUxSetProgress(100, "Tayyor!");

      // Auto-fetch translations in background
      prefetchTranslations(extractedWords);
    } catch (e) {
      console.error("OCR Error:", e);
      setOcrStatus(`Skanerlashda xato: ${e.message || e}`);
      ocrUxSetProgress(0, "Xato");
    } finally {
      setTimeout(() => ocrUxHide(), 1000);
    }
  }

  function getStorageKey() { return "LC_CHATS_ZIYOKOR"; }
  function getLocalChats() {
    try { return JSON.parse(localStorage.getItem(getStorageKey()) || "[]"); } catch { return []; }
  }
  function saveLocalChats(list) { localStorage.setItem(getStorageKey(), JSON.stringify(list)); }

  async function loadChats() {
    chats = getLocalChats();
    chats.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    renderChatList();
  }

  function deleteLocalChat(id) {
    if (!confirm("Haqiqatdan ham bu chatni o‘chirmoqchimisiz?")) return;
    let list = getLocalChats();
    list = list.filter(c => c.id !== id);
    saveLocalChats(list);
    if (activeChat && activeChat.id === id) setActiveChat(null);
    loadChats();
  }

  function renderChatList() {
    if (!chats.length) { chatList.textContent = "Hozircha chat yo‘q."; return; }
    chatList.innerHTML = "";
    chats.forEach((c) => {
      const wrapper = document.createElement("div");
      wrapper.className = "chat-item-wrapper";
      const item = document.createElement("div");
      item.className = "chat-item";
      item.textContent = c.title || "Untitled chat";
      item.style.flex = "1";
      item.addEventListener("click", () => openChat(c));
      const delBtn = document.createElement("button");
      delBtn.className = "btn-del";
      delBtn.innerHTML = "🗑️";
      delBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteLocalChat(c.id); });
      wrapper.appendChild(item);
      wrapper.appendChild(delBtn);
      chatList.appendChild(wrapper);
    });
  }

  async function openChat(chat) {
    activeChat = chat;
    setActiveChat(chat);
    activeCards = [...(chat.cards || [])];
    for (let i = activeCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [activeCards[i], activeCards[j]] = [activeCards[j], activeCards[i]];
    }
    cardIndex = 0;
    testCardIndex = 0;
    renderCard();
    renderCardsList();
    renderTestCard();
  }

  function setActiveChat(chat) {
    activeChat = chat;
    if (!chat) {
      activeChatTitle.textContent = "Flashcards";
      activeChatMeta.textContent = "—";
      activeCards = [];
      cardIndex = 0;
      renderCard();
      renderCardsList();
      renderTestCard();
      return;
    }
    activeChatTitle.textContent = chat.title || "Untitled chat";
    activeChatMeta.textContent = "Active";
  }

  function renderCardsList() {
    if (!cardsList) return;
    if (!activeChat) {
      cardsList.textContent = "Chat tanlansa, cardlar ro‘yxati shu yerda ko‘rinadi.";
      return;
    }
    if (!activeCards.length) {
      cardsList.textContent = "Bu chatda card yo‘q.";
      return;
    }
    cardsList.textContent = activeCards.map((c, i) => `${i + 1}. ${c.en} → ${c.uz || ""}`).join("\n");
  }

  function showFront() { cardBack.classList.add("hidden"); cardFront.classList.remove("hidden"); }
  function showBack() { cardFront.classList.add("hidden"); cardBack.classList.remove("hidden"); }

  function renderCard() {
    if (!activeChat || !activeCards.length) {
      showFront();
      frontText.textContent = activeChat ? "Bu chatda card yo‘q." : "Chat tanlang yoki yarating.";
      backText.textContent = "—";
      exampleText.textContent = "";
      return;
    }
    const c = activeCards[cardIndex];
    showFront();
    frontText.textContent = c.en || "—";
    backText.textContent = c.uz || "—";
    exampleText.textContent = "";
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function renderTestCard() {
    if (!testOptions) return;
    testOptions.innerHTML = "";

    if (!activeChat || !activeCards.length) {
      if (testQuestionWord) testQuestionWord.textContent = "Start Scan First";
      return;
    }

    // Safety check
    if (testCardIndex >= activeCards.length) testCardIndex = 0;

    const currentCard = activeCards[testCardIndex];
    if (testQuestionWord) testQuestionWord.textContent = currentCard.uz || "---";

    // Prepare options (Correct is English)
    const correctAnswer = currentCard.en || "???";
    let options = [correctAnswer];

    // Get distractors (English words)
    const pool = activeCards.filter(c => c.en !== correctAnswer && c.en);

    if (pool.length < 2) {
      if (pool.length === 0) options.push("Wrong 1", "Wrong 2");
      else options.push(pool[0].en, "Wrong Option");
    } else {
      const shuffledPool = shuffleArray([...pool]);
      options.push(shuffledPool[0].en);
      options.push(shuffledPool[1].en);
    }

    // Shuffle options
    options = shuffleArray(options);

    options.forEach(opt => {
      const btn = document.createElement("div");
      btn.className = "quiz-btn";
      btn.textContent = opt;
      btn.onclick = () => {
        // Prevent multi-click logic if needed, but for now allow re-clicking
        Array.from(testOptions.children).forEach(b => {
          b.classList.remove("correct", "wrong");
        });

        if (opt === correctAnswer) {
          btn.classList.add("correct");
        } else {
          btn.classList.add("wrong");
          // Reveal correct
          Array.from(testOptions.children).forEach(b => {
            if (b.textContent === correctAnswer) b.classList.add("correct");
          });
        }
      };
      testOptions.appendChild(btn);
    });
  }

  function speakActiveWord() {
    const text = activeCards[cardIndex]?.en;
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  async function prefetchTranslations(words) {
    if (!words || !words.length) return;

    const wordsToQuery = words.filter(w => !translationMap.has(w) || !translationMap.get(w));
    if (wordsToQuery.length === 0) return;

    console.log("Prefetching translations for:", wordsToQuery.length, "words");
    // Optional status update
    if (wordsToQuery.length > 5) {
      // setCreateStatus(`Orqa fonda tarjima qilinmoqda... (${wordsToQuery.length} ta)`);
    }

    const BATCH_SIZE = 10;
    const MAX_CONCURRENT_BATCHES = 3;

    const allBatches = [];
    for (let i = 0; i < wordsToQuery.length; i += BATCH_SIZE) {
      allBatches.push(wordsToQuery.slice(i, i + BATCH_SIZE));
    }

    const processBatch = async (batch) => {
      try {
        if (activeTranslateUrl) {
          const res = await fetch(activeTranslateUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ words: batch })
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.translated) {
            Object.entries(data.translated).forEach(([k, v]) => {
              if (v) translationMap.set(k, v);
            });
          }
        } else if (GAS_TRANSLATE_URL) {
          await Promise.all(batch.map(async w => {
            try {
              const params = new URLSearchParams({ q: w, source: "en", target: "uz" });
              const res = await fetch(`${GAS_TRANSLATE_URL}?${params}`, { redirect: "follow" });
              const data = await res.json().catch(() => ({}));
              if (data.translatedText) {
                translationMap.set(w, data.translatedText);
              }
            } catch (e) { }
          }));
        }
        renderWords();
      } catch (e) {
        console.warn("Prefetch error:", e);
      }
    };

    for (let i = 0; i < allBatches.length; i += MAX_CONCURRENT_BATCHES) {
      const chunk = allBatches.slice(i, i + MAX_CONCURRENT_BATCHES);
      await Promise.all(chunk.map(batch => processBatch(batch)));
    }

    setCreateStatus("");
    renderWords();
  }

  async function createChatFromWords() {
    if (!extractedWords.length) return setCreateStatus("So‘zlar yo‘q. Avval Scan qiling.");
    createChatBtn.disabled = true;
    try {
      setCreateStatus("Tarjima qilinmoqda...");
      const title = safeTrim(chatTitle.value) || `Reading chat ${new Date().toLocaleString()}`;
      const words = extractedWords;
      let translations = {};
      const wordsToQuery = words.filter(w => !translationMap.has(w) || !translationMap.get(w));

      if (wordsToQuery.length > 0) {
        // PARALLEL BATCH PROCESSING (V15 - Safe Parallel Batching)
        // Optimization: Reduced to 10 because GAS fallback uses 2 subrequests per word (redirect). 
        // 10 words = 20 subrequests (Safe). 25 words = 50 subrequests (Crash).
        const BATCH_SIZE = 10;
        const MAX_CONCURRENT_BATCHES = 3; // 10 * 3 = 30 words in flight

        const allBatches = [];
        for (let i = 0; i < wordsToQuery.length; i += BATCH_SIZE) {
          allBatches.push(wordsToQuery.slice(i, i + BATCH_SIZE));
        }

        let processedCount = 0;
        let errorCount = 0;

        // Function to process a single batch
        const processBatch = async (batch) => {
          try {
            if (activeTranslateUrl) {
              const res = await fetch(activeTranslateUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ words: batch })
              });
              const data = await res.json().catch(() => ({}));

              if (res.ok && data.translated) {
                Object.assign(translations, data.translated);
                Object.entries(data.translated).forEach(([k, v]) => translationMap.set(k, v));
              } else {
                batch.forEach(w => {
                  if (!translations[w]) {
                    translations[w] = "[Error: Retry]"; // Clearer error message
                    translationMap.set(w, null); // Don't cache error permanently so retry works
                    errorCount++;
                  }
                });
              }
            } else if (GAS_TRANSLATE_URL) {
              await Promise.all(batch.map(async w => {
                try {
                  const params = new URLSearchParams({ q: w, source: "en", target: "uz" });
                  const res = await fetch(`${GAS_TRANSLATE_URL}?${params}`, { redirect: "follow" });
                  const data = await res.json().catch(() => ({}));
                  if (data.translatedText) {
                    translations[w] = data.translatedText;
                    translationMap.set(w, data.translatedText);
                  } else {
                    // Silent fail or clear error
                    translations[w] = "";
                    errorCount++;
                  }
                } catch (e) {
                  translations[w] = "";
                  errorCount++;
                }
              }));
            } else {
              batch.forEach(w => translations[w] = "[No Config]");
            }
          } catch (e) {
            console.error("Batch error:", e);
            batch.forEach(w => {
              if (!translations[w]) translations[w] = "[App Error]";
              errorCount++;
            });
          }

          processedCount += batch.length;
          // User requested format: "1,2,3... ta tarjima qilindi"
          const currentCount = Math.min(processedCount, wordsToQuery.length);
          setCreateStatus(`${currentCount} ta so‘z tarjima qilindi... (${wordsToQuery.length} tadan)`);
          renderWords();
        };

        // Execute batches with concurrency limit
        for (let i = 0; i < allBatches.length; i += MAX_CONCURRENT_BATCHES) {
          const chunk = allBatches.slice(i, i + MAX_CONCURRENT_BATCHES);
          await Promise.all(chunk.map(batch => processBatch(batch)));
        }

        if (errorCount > 0) {
          setCreateStatus(`Tayyor (⚠️ ${errorCount} ta xato). "Create Chat" ni qayta bosing (xatolar qayta uriniladi).`);
        } else {
          setCreateStatus(`✅ Tayyor. Chat yaratildi (${words.length} ta so‘z).`);
        }
      }

      const newChat = {
        id: "loc_" + Date.now(),
        title,
        created_at: new Date().toISOString(),
        cards: words.map((en) => ({ id: "c_" + Math.random().toString(36).slice(2), en, uz: translations[en] || translationMap.get(en) || "" }))
      };
      const list = getLocalChats();
      list.push(newChat);
      saveLocalChats(list);
      setCreateStatus(`✅ Tayyor. Chat yaratildi (${words.length} ta so‘z).`);
      extractedWords = [];
      translationMap = new Map();
      renderWords();
      chatTitle.value = "";
      await loadChats();
      await openChat(newChat);
    } catch (e) {
      setCreateStatus(`Xato: ${e.message || e}`);
    } finally { createChatBtn.disabled = false; }
  }

  // CROPPER LOGIC
  let cropper = null;
  const cropModal = el("cropModal");
  const cropImage = el("cropImage");
  const cancelCropBtn = el("cancelCropBtn");
  const confirmCropBtn = el("confirmCropBtn");

  function openCropModal(file) {
    if (!cropModal || !cropImage) return;

    const url = URL.createObjectURL(file);
    cropImage.src = url;
    cropModal.classList.remove("hidden"); // Remove 'hidden' class to show

    // Destroy previous instance
    if (cropper) cropper.destroy();

    // Init Cropper
    cropper = new Cropper(cropImage, {
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.9,
      restore: false,
      guides: true,
      center: true,
      highlight: false,
      cropBoxMovable: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
    });
  }

  function closeCropModal() {
    if (cropModal) cropModal.classList.add("hidden"); // Add 'hidden' class to hide
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }
    if (cropImage) cropImage.src = "";
  }

  if (runOcrBtn) runOcrBtn.addEventListener("click", async () => {
    const file = imageInput?.files?.[0];
    if (!file) return setOcrStatus("Avval rasm tanlang.");

    // Open Modal instead of running OCR directly
    openCropModal(file);
  });

  if (cancelCropBtn) cancelCropBtn.addEventListener("click", closeCropModal);

  if (confirmCropBtn) confirmCropBtn.addEventListener("click", () => {
    if (!cropper) return;

    // Get cropped blob
    cropper.getCroppedCanvas({ maxWidth: 2048, maxHeight: 2048 }).toBlob(async (blob) => {
      if (!blob) return setOcrStatus("Qirqishda xatolik.");

      closeCropModal();

      // Convert blob to file object for runClientOcr (it expects a File usually, but Blob works too if treated right)
      const file = new File([blob], "cropped.jpg", { type: "image/jpeg" });
      await runClientOcr(file);

    }, 'image/jpeg', 0.95);
  });

  if (clearScanBtn) clearScanBtn.addEventListener("click", () => {
    if (imageInput) imageInput.value = "";
    extractedWords = [];
    translationMap = new Map();
    renderWords();
    setOcrStatus("");
    setCreateStatus("");
    ocrUxHide();
  });

  if (addManualWordBtn) addManualWordBtn.addEventListener("click", () => {
    const w = normalizeWord(manualWord?.value);
    if (!w) return;
    if (!extractedWords.includes(w)) extractedWords.push(w);
    if (manualWord) manualWord.value = "";
    renderWords();
  });

  if (manualWord) manualWord.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addManualWordBtn?.click(); } });

  if (createChatBtn) createChatBtn.addEventListener("click", createChatFromWords);

  const handleSpeak = (e) => { e.stopPropagation(); speakActiveWord(); };
  if (speakBtn) speakBtn.addEventListener("click", handleSpeak);
  if (speakBtnBack) speakBtnBack.addEventListener("click", handleSpeak);

  if (card) card.addEventListener("click", () => { if (cardBack && cardBack.classList.contains("hidden")) showBack(); else showFront(); });

  if (prevBtn) prevBtn.addEventListener("click", () => { if (!activeCards.length) return; cardIndex = (cardIndex - 1 + activeCards.length) % activeCards.length; renderCard(); });
  if (nextBtn) nextBtn.addEventListener("click", () => { if (!activeCards.length) return; cardIndex = (cardIndex + 1) % activeCards.length; renderCard(); });

  if (testPrevBtn) testPrevBtn.addEventListener("click", () => {
    if (!activeCards.length) return;
    testCardIndex = (testCardIndex - 1 + activeCards.length) % activeCards.length;
    renderTestCard();
  });
  if (testNextBtn) testNextBtn.addEventListener("click", () => {
    if (!activeCards.length) return;
    testCardIndex = (testCardIndex + 1) % activeCards.length;
    renderTestCard();
  });

  (async () => {
    extractedWords = [];
    translationMap = new Map();
    renderWords();
    setActiveChat(null);
    await loadChats();
  })();
});
