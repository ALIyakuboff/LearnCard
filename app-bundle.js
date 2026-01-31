document.addEventListener("DOMContentLoaded", () => {
  // CONFIG: LocalStorage mode with Auth requirement
  const cfg = window.APP_CONFIG || {};
  const OCR_WORKER_URL = cfg.OCR_WORKER_URL || "";
  // const TRANSLATE_URL = cfg.TRANSLATE_URL || ""; // Unused

  const el = (id) => document.getElementById(id);
  const setText = (node, text) => { if (node) node.textContent = text ?? ""; };
  const safeTrim = (s) => (s || "").trim();

  // Auth elements removed

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


  // Removed sessionUser

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

  const headerActions = document.querySelector(".header-actions");

  // Auth UI and sync logic removed.


  async function runServerOcr(file) {
    // Auth check removed

    if (!OCR_WORKER_URL.startsWith("https://")) return setOcrStatus("Worker URL yo‘q.");

    ocrUxShow();
    setOcrStatus("Preparing image...");
    ocrUxSetProgress(10, "Preparing...");

    try {
      const fixedFile = await toSafeImageFile(file);

      const fd = new FormData();
      fd.append("image", fixedFile, fixedFile.name);

      ocrUxSetProgress(55, "OCR server...");
      const res = await fetch(OCR_WORKER_URL, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = json?.error ? String(json.error) : `HTTP ${res.status}`;
        const prov = json?.providerMessage ? ` (${json.providerMessage})` : "";
        setOcrStatus(`Server error: ${msg}${prov}`);
        ocrUxSetProgress(0, "Failed");
        return;
      }

      const text = (json?.text || "").trim();
      let words = Array.isArray(json?.words) ? json.words : [];
      if (words.length === 0 && text) words = extractWordsFromText(text);

      extractedWords = words.map(normalizeWord).filter(Boolean).slice(0, 100);

      translationMap = new Map();
      const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
      for (const p of pairs) {
        const en = normalizeWord(p?.en);
        if (!en) continue;
        translationMap.set(en, typeof p?.uz === "string" ? p.uz : "");
      }

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

  // --- LOCAL STORAGE HELPERS ---
  function getStorageKey() {
    return "LC_CHATS_ZIYOKOR";
  }

  function getLocalChats() {
    const key = getStorageKey();
    if (!key) return [];
    try {
      return JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      return [];
    }
  }

  function saveLocalChats(list) {
    const key = getStorageKey();
    if (key) localStorage.setItem(key, JSON.stringify(list));
  }
  // -----------------------------

  async function loadChats() {
    // Auth check removed

    // Load from LocalStorage (Instant)
    chats = getLocalChats();
    // Sort by Date DESC
    chats.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    renderChatList();
  }

  function renderChatList() {
    // if (!sessionUser) return; 

    if (!chats.length) {
      chatList.textContent = "Hozircha chat yo‘q.";
      return;
    }

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
      delBtn.title = "O'chirish";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteLocalChat(c.id);
      });

      wrapper.appendChild(item);
      wrapper.appendChild(delBtn);
      chatList.appendChild(wrapper);
    });
  }

  async function openChat(chat) {
    activeChat = chat;
    setActiveChat(chat);
    // Cards are embedded in the chat object now
    let rawCards = chat.cards || [];

    // Auto-Shuffle (Fisher-Yates)
    activeCards = [...rawCards];
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
    if (!activeChat) {
      showFront();
      frontText.textContent = "Chat tanlang yoki yarating.";
      backText.textContent = "—";
      exampleText.textContent = "";
      return;
    }
    if (!activeCards.length) {
      showFront();
      frontText.textContent = "Bu chatda card yo‘q.";
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

  // --- TEXT TO SPEECH ---
  function speakActiveWord() {
    if (!activeCards[cardIndex]) return;
    const text = activeCards[cardIndex].en;
    if (!text) return;

    // Use native Speech Synthesis
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.9; // Slightly slower for clarity
    window.speechSynthesis.cancel(); // Stop current speech
    window.speechSynthesis.speak(utterance);
  }
  // ---------------------

  async function createChatFromWords() {
    // Auth check removed
    if (!extractedWords.length) return setCreateStatus("So‘zlar yo‘q. Avval Scan qiling.");

    createChatBtn.disabled = true;

    try {
      setCreateStatus("Tarjima qilinmoqda...");

      const title = safeTrim(chatTitle.value) || `Reading chat ${new Date().toLocaleString()}`;
      const words = extractedWords.slice(0, 100);

      let translations = {};
      const batchSize = 7; // Faster batch size
      const INTER_BATCH_DELAY_MS = 1000; // 1s delay (Speed mode)

      // Identify words that NEED translation (not in translationMap)
      const wordsToQuery = words.filter(w => !translationMap.has(w) || !translationMap.get(w));

      if (wordsToQuery.length > 0) {
        setCreateStatus(`Jami ${wordsToQuery.length} ta so'z tarjima qilinmoqda. Sabr qiling...`);

        for (let i = 0; i < wordsToQuery.length; i += batchSize) {
          const chunk = wordsToQuery.slice(i, i + batchSize);

          if (i > 0) {
            setCreateStatus(`Kuting... (${i}/${wordsToQuery.length})`);
            await new Promise(r => setTimeout(r, INTER_BATCH_DELAY_MS));
          }

          setCreateStatus(`Tarjima qilinmoqda... (${i + 1}-${Math.min(i + batchSize, wordsToQuery.length)}/${wordsToQuery.length})`);

          // Batch format: "1. word1\n2. word2..."
          const textToTranslate = chunk.map((w, idx) => `${idx + 1}. ${w}`).join("\n");

          try {
            // Call our Worker Proxy instead of Google directly (avoids CORS)
            const res = await fetch(OCR_WORKER_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "translate", text: textToTranslate })
            });

            if (!res.ok) {
              console.warn("Fetch failed:", res.status);
              setCreateStatus(`Server band (${res.status}). Qayta urinish...`);
              await new Promise(r => setTimeout(r, 2000));
              i -= batchSize; // Retry
              continue;
            }

            const data = await res.json();
            const translatedBlock = typeof data?.translated === "string" ? data.translated : "";

            const lines = translatedBlock.split("\n");
            let foundIdx = 0;
            for (const line of lines) {
              const match = line.match(/^\s*\d+[\.\)\:\s-]+\s*(.+)/);
              let clean = match ? match[1].trim() : line.trim();

              if (clean.startsWith("[Exception") || clean.startsWith("[Error")) {
                console.warn("Translation exception for", chunk[foundIdx], clean);
              }

              if (clean && foundIdx < chunk.length) {
                translations[chunk[foundIdx]] = clean;
                translationMap.set(chunk[foundIdx], clean);
                foundIdx++;
              }
            }
            renderWords();

          } catch (fetchErr) {
            console.error("Batch fetch error (proxy):", fetchErr);
            setCreateStatus(`Tarmoq xatosi. Qayta ulanish...`);
            await new Promise(r => setTimeout(r, 3000));
            i -= batchSize; // Retry
          }
        }
      }

      setCreateStatus("Chat yaratilmoqda...");

      // Prepare local object with translations
      const newChat = {
        id: "loc_" + Date.now(),
        title,
        created_at: new Date().toISOString(),
        cards: words.map((en) => ({
          id: "c_" + Math.random().toString(36).slice(2),
          en,
          uz: translations[en] || translationMap.get(en) || "",
        }))
      };

      // Save to USER scoped local storage
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
    } finally {
      createChatBtn.disabled = false;
    }
  }

  function deleteLocalChat(id) {
    if (!confirm("Haqiqatdan ham ushbu chatni o'chirmoqchimisiz?")) return;
    const list = getLocalChats();
    const filtered = list.filter(c => c.id !== id);
    saveLocalChats(filtered);

    if (activeChat && activeChat.id === id) {
      setActiveChat(null);
    }

    loadChats();
  }

  // Export active chat
  function exportActiveChat() {
    if (!activeChat) return setCreateStatus("Export uchun chat tanlang.");

    const payload = {
      title: activeChat.title || "Untitled chat",
      created_at: activeChat.created_at,
      cards: activeCards.map((c) => ({ en: c.en, uz: c.uz || "" })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(activeChat.title || "chat").replace(/\s+/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Events


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

  if (manualWord) manualWord.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addManualWordBtn?.click();
    }
  });

  if (createChatBtn) createChatBtn.addEventListener("click", createChatFromWords);

  const handleSpeak = (e) => {
    e.stopPropagation(); // Don't flip card
    speakActiveWord();
  };

  if (speakBtn) speakBtn.addEventListener("click", handleSpeak);
  if (speakBtnBack) speakBtnBack.addEventListener("click", handleSpeak);

  if (card) card.addEventListener("click", () => {
    if (cardBack && cardBack.classList.contains("hidden")) showBack(); else showFront();
  });

  if (prevBtn) prevBtn.addEventListener("click", () => {
    if (!activeCards.length) return;
    cardIndex = (cardIndex - 1 + activeCards.length) % activeCards.length;
    renderCard();
  });

  if (nextBtn) nextBtn.addEventListener("click", () => {
    if (!activeCards.length) return;
    cardIndex = (cardIndex + 1) % activeCards.length;
    renderCard();
  });

  // Init
  (async () => {
    extractedWords = [];
    translationMap = new Map();
    renderWords();
    setActiveChat(null);

    await loadChats();
  })();
});
