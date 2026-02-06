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
    if (ocrProgressText) ocrProgressText.textContent = "Starting...";
  }
  function ocrUxHide() { if (ocrUx) ocrUx.classList.add("hidden"); }
  function ocrUxSetProgress(pct, text) {
    const p = Math.max(0, Math.min(100, pct));
    if (ocrProgressBar) ocrProgressBar.style.width = `${p}%`;
    if (ocrProgressText) ocrProgressText.textContent = text || `${p}%`;
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

  function extractWordsFromText(text) {
    const raw = (text || "").toLowerCase();
    const parts = raw.split(/[\s\n\r\t]+/g);
    const seen = new Set();
    const out = [];
    for (const p of parts) {
      const w = normalizeWord(p);
      if (!w) continue;
      if (w.length < 3) continue;
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }
    return out;
  }

  async function toSafeImageFile(originalFile, maxSide = 800, jpegQuality = 0.7) {
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
      const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (pngBlob) return new File([pngBlob], "ocr.png", { type: "image/png" });
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
      chip.textContent = trans ? `${w} (${trans})` : w;
      chip.title = "Bosib olib tashlang";
      chip.addEventListener("click", () => {
        extractedWords = extractedWords.filter((x) => x !== w);
        translationMap.delete(w);
        renderWords();
      });
      wordsChips.appendChild(chip);
    });
  }

  async function runClientOcr(file) {
    if (!file) return;
    try {
      ocrUxShow();
      ocrUxSetProgress(10, "Skaner tayyorlanmoqda...");

      const worker = await Tesseract.createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            ocrUxSetProgress(20 + Math.round(m.progress * 70), `Skanerlash: ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      const { data: { text } } = await worker.recognize(file);
      await worker.terminate();

      if (!text || text.trim().length < 2) {
        setOcrStatus("⚠️ Matn topilmadi. Boshqa rasm bilan ko'ring.");
        ocrUxSetProgress(0, "No text found");
        return;
      }

      console.log("OCR Result:", text);
      const words = extractWordsFromText(text);
      extractedWords = words.map(normalizeWord).filter(Boolean).slice(0, 150);

      translationMap = new Map();
      renderWords();
      setOcrStatus(`Muvaffaqiyatli: ${extractedWords.length} ta so'z ajratildi.`);
      ocrUxSetProgress(100, "Tayyor!");
    } catch (e) {
      console.error("Client OCR Error:", e);
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

  async function createChatFromWords() {
    if (!extractedWords.length) return setCreateStatus("So‘zlar yo‘q. Avval Scan qiling.");
    createChatBtn.disabled = true;
    try {
      setCreateStatus("Tarjima qilinmoqda...");
      const title = safeTrim(chatTitle.value) || `Reading chat ${new Date().toLocaleString()}`;
      const words = extractedWords.slice(0, 100);
      let translations = {};
      const wordsToQuery = words.filter(w => !translationMap.has(w) || !translationMap.get(w));

      if (wordsToQuery.length > 0) {
        // SEQUENTIAL STABILITY PROTOCOL (V12)
        let processed = 0;
        for (const w of wordsToQuery) {
          setCreateStatus(`Tarjima: ${processed + 1}/${wordsToQuery.length} (${w})`);
          let translationResult = "";
          let success = false;

          let workerError = null;

          // Strategy 1: Dedicated Translation Worker
          if (activeTranslateUrl) {
            try {
              const res = await fetch(activeTranslateUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ word: w })
              });
              const data = await res.json().catch(() => ({}));
              if (res.ok && data.translated && !data.translated.startsWith("[")) {
                translationResult = data.translated;
                success = true;
              } else {
                workerError = data.translated || `Worker Status ${res.status}`;
                console.warn(`Translate worker failed for ${w}: ${workerError}`);
              }
            } catch (e) {
              workerError = e.message;
              console.error(`Translate worker error for ${w}:`, e);
            }
          }

          // Fallback: Google Apps Script (GAS)
          if (!success && GAS_TRANSLATE_URL) {
            try {
              console.log("Attempting GAS Fallback...");
              const params = new URLSearchParams({ q: w, source: "en", target: "uz" });
              const res = await fetch(`${GAS_TRANSLATE_URL}?${params}`, {
                method: "GET",
                redirect: "follow"
              });
              const data = await res.json().catch(() => ({}));
              if (data.status === "success" && data.translatedText) {
                translationResult = data.translatedText;
                success = true;
              } else {
                console.warn("GAS Fallback response invalid:", data);
              }
            } catch (e) {
              console.error(`GAS fallback error for ${w}:`, e);
            }
          }

          if (success) {
            translations[w] = translationResult;
            translationMap.set(w, translationResult);
          } else {
            const errorMsg = workerError ? `[Err: ${workerError}]` : "[Xatolik]";
            translations[w] = errorMsg;
            translationMap.set(w, errorMsg);
          }

          processed++;
          renderWords(); // Real-time update
          await new Promise(r => setTimeout(r, 150)); // ANTI-BURST
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

  if (runOcrBtn) runOcrBtn.addEventListener("click", async () => {
    const file = imageInput?.files?.[0];
    if (!file) return setOcrStatus("Avval rasm tanlang.");
    await runClientOcr(file);
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
