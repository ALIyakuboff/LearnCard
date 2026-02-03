document.addEventListener("DOMContentLoaded", () => {
  // CONFIG: LocalStorage mode with Auth requirement
  const cfg = window.APP_CONFIG || {};
  const OCR_WORKER_URLS = cfg.OCR_WORKER_URLS || {};
  const TRANSLATE_WORKER_URLS = cfg.TRANSLATE_WORKER_URLS || {};
  let currentLevel = localStorage.getItem("LC_SELECTED_LEVEL") || "beginner";
  let activeWorkerUrl = OCR_WORKER_URLS[currentLevel] || "";
  let activeTranslateUrl = TRANSLATE_WORKER_URLS[currentLevel] || "";

  const GAS_TRANSLATE_URL = cfg.GAS_TRANSLATE_URL || "https://script.google.com/macros/s/AKfycbwU25xoSCC38egP4KnblHvrW88gwJwi2kLEL9O7DDpsmOONBxd4KRi3EnY9xndBxmcS/exec";

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

  const cardsList = el("cardsList");
  const levelBtns = document.querySelectorAll(".level-btn");

  function updateActiveLevel(level) {
    currentLevel = level;
    activeWorkerUrl = OCR_WORKER_URLS[level] || "";
    activeTranslateUrl = TRANSLATE_WORKER_URLS[level] || "";
    localStorage.setItem("LC_SELECTED_LEVEL", level);
    levelBtns.forEach(btn => {
      if (btn.dataset.level === level) btn.classList.add("active");
      else btn.classList.remove("active");
    });
    console.log(`Level: ${level}, OCR: ${activeWorkerUrl}, Trans: ${activeTranslateUrl}`);
  }

  levelBtns.forEach(btn => {
    btn.addEventListener("click", () => updateActiveLevel(btn.dataset.level));
  });

  // Init UI
  levelBtns.forEach(btn => {
    if (btn.dataset.level === currentLevel) btn.classList.add("active");
    else btn.classList.remove("active");
  });

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

  async function toSafeImageFile(originalFile, maxSide = 1600, jpegQuality = 0.85) {
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

  async function runServerOcr(file) {
    if (!activeWorkerUrl || !activeWorkerUrl.startsWith("https://")) return setOcrStatus("Worker URL yo‘q.");
    ocrUxShow();
    setOcrStatus("Preparing image...");
    ocrUxSetProgress(10, "Preparing...");
    try {
      const fixedFile = await toSafeImageFile(file);
      const fd = new FormData();
      fd.append("image", fixedFile, fixedFile.name);
      ocrUxSetProgress(55, "OCR server...");
      const res = await fetch(activeWorkerUrl, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOcrStatus(`Server error: ${json?.error || res.status}`);
        ocrUxSetProgress(0, "Failed");
        return;
      }
      const text = (json?.text || "").trim();
      let words = Array.isArray(json?.words) ? json.words : [];
      if (words.length === 0 && text) words = extractWordsFromText(text);
      extractedWords = words.map(normalizeWord).filter(Boolean).slice(0, 100);
      translationMap = new Map();
      renderWords();
      setOcrStatus(`Done. Words: ${extractedWords.length}`);
      ocrUxSetProgress(100, `Done. ${extractedWords.length} words`);
    } catch (e) {
      setOcrStatus(`OCR error: ${String(e?.message || e)}`);
      ocrUxSetProgress(0, "Failed");
    } finally {
      setTimeout(() => ocrUxHide(), 600);
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
    renderCard();
    renderCardsList();
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
      return;
    }
    activeChatTitle.textContent = chat.title || "Untitled chat";
    activeChatMeta.textContent = "Active";
  }

  function renderCardsList() {
    if (!activeChat) { cardsList.textContent = "Chat tanlansa, cardlar ro‘yxati shu yerda ko‘rinadi."; return; }
    if (!activeCards.length) { cardsList.textContent = "Bu chatda card yo‘q."; return; }
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
              } else if (res.status === 404) {
                console.warn(`Translate worker 404: ${activeTranslateUrl}`);
              }
            } catch (e) {
              console.error(`Translate worker error for ${w}:`, e);
            }
          }

          // Strategy 2: OCR Worker Fallback (Action: translate)
          if (!success && activeWorkerUrl) {
            try {
              const resOcr = await fetch(activeWorkerUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "translate", word: w, gasUrl: GAS_TRANSLATE_URL })
              });
              const dataOcr = await resOcr.json().catch(() => ({}));
              if (resOcr.ok && dataOcr.translated && !dataOcr.translated.startsWith("[")) {
                translationResult = dataOcr.translated;
                success = true;
              } else {
                translationResult = dataOcr.translated || dataOcr.error || `Error ${resOcr.status}`;
              }
            } catch (e) {
              console.error(`OCR fallback error for ${w}:`, e);
              translationResult = "Connection Error";
            }
          }

          if (success) {
            translations[w] = translationResult;
            translationMap.set(w, translationResult);
          } else {
            translations[w] = translationResult ? `[${translationResult}]` : "[Xatolik]";
            translationMap.set(w, translations[w]);
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
    await runServerOcr(file);
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

  (async () => {
    extractedWords = [];
    translationMap = new Map();
    renderWords();
    setActiveChat(null);
    await loadChats();
  })();
});
