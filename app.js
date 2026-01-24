/* app.js — OCR + EN→UZ translate + per-user chats (max 2) + Supabase storage */

document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.APP_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || "";

  // --- DOM helpers
  const el = (id) => document.getElementById(id);
  const setText = (node, text) => { if (node) node.textContent = text ?? ""; };

  // Header/Auth
  const userLine = el("userLine");
  const accountLabel = el("accountLabel");
  const signInBtn = el("signInBtn");
  const signUpBtn = el("signUpBtn");
  const signOutBtn = el("signOutBtn");

  // OCR UI
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

  // Create chat
  const chatTitle = el("chatTitle");
  const createChatBtn = el("createChatBtn");
  const createStatus = el("createStatus");
  const chatList = el("chatList");

  // Flashcards
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

  // Import/export
  const exportBtn = el("exportBtn");
  const importBtn = el("importBtn");
  const importFile = el("importFile");
  const cardsList = el("cardsList");

  // --- status helpers
  function setOcrStatus(msg) { setText(ocrStatus, msg); }
  function setCreateStatus(msg) { setText(createStatus, msg); }

  function ocrUxShow() {
    ocrUx?.classList.remove("hidden");
    if (ocrProgressBar) ocrProgressBar.style.width = "0%";
    if (ocrProgressText) ocrProgressText.textContent = "Preparing...";
  }
  function ocrUxHide() { ocrUx?.classList.add("hidden"); }
  function ocrUxSetProgress(pct, text) {
    const p = Math.max(0, Math.min(100, pct));
    if (ocrProgressBar) ocrProgressBar.style.width = `${p}%`;
    if (ocrProgressText) ocrProgressText.textContent = text || `${p}%`;
  }
  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
  }

  // --- Supabase client
  if (!SUPABASE_URL.startsWith("https://") || SUPABASE_ANON_KEY.length < 10) {
    setText(userLine, "Supabase config noto‘g‘ri. config.js ni tekshiring.");
    return;
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // --- App state
  let sessionUser = null;

  let extractedWords = [];      // from OCR
  let chats = [];              // user chats
  let activeChat = null;       // selected chat object
  let cards = [];              // cards in active chat
  let currentIndex = 0;

  // --- Auth UI updates
  function setSignedOutUI() {
    sessionUser = null;

    userLine.textContent = "Sign in qiling.";
    accountLabel.classList.add("hidden");
    accountLabel.textContent = "";

    signInBtn.classList.remove("hidden");
    signUpBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");

    chatList.textContent = "Sign in qiling — chatlar shu yerda chiqadi.";
    cardsList.textContent = "Chat tanlansa, cardlar ro‘yxati shu yerda ko‘rinadi.";
    setActiveChat(null);
  }

  function setSignedInUI(user) {
    sessionUser = user;

    const email = user?.email || "signed-in";
    userLine.textContent = "Kirgansiz.";
    accountLabel.textContent = email;
    accountLabel.classList.remove("hidden");

    signInBtn.classList.add("hidden");
    signUpBtn.classList.add("hidden");
    signOutBtn.classList.remove("hidden");
  }

  async function refreshSessionAndUI() {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user || null;
    if (!user) {
      setSignedOutUI();
      return;
    }
    setSignedInUI(user);
  }

  // --- Render words chips
  function renderWords() {
    if (!wordsChips) return;

    if (!extractedWords.length) {
      wordsChips.textContent = "Hozircha so‘z yo‘q.";
      wordsChips.classList.add("muted");
      return;
    }

    wordsChips.classList.remove("muted");
    wordsChips.innerHTML = "";

    extractedWords.forEach((w, idx) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = w;
      chip.title = "Bosib olib tashlang";

      chip.addEventListener("click", () => {
        extractedWords.splice(idx, 1);
        renderWords();
      });

      wordsChips.appendChild(chip);
    });
  }

  function normalizeWord(w) {
    return (w || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z']/g, ""); // keep apostrophes
  }

  // --- Extract words from OCR text
  function extractWordsFromText(text) {
    const raw = (text || "").toLowerCase();
    const parts = raw.split(/[\s\n\r\t]+/g);

    const seen = new Set();
    const out = [];

    for (const p of parts) {
      const w = normalizeWord(p);
      if (!w) continue;
      if (w.length < 3) continue; // ignore too short
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }

    return out;
  }

  // --- Image preprocessing for better OCR
  function clamp255(x) { return Math.max(0, Math.min(255, x)); }

  function sharpenImageData(imgData, amount = 0.55) {
    const { data, width, height } = imgData;
    const out = new Uint8ClampedArray(data.length);

    const kernel = [
      1/9, 1/9, 1/9,
      1/9, 1/9, 1/9,
      1/9, 1/9, 1/9,
    ];

    const getIdx = (x, y) => (y * width + x) * 4;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let br = 0, bg = 0, bb = 0;
        let ki = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = getIdx(x + kx, y + ky);
            const w = kernel[ki++];
            br += data[idx] * w;
            bg += data[idx + 1] * w;
            bb += data[idx + 2] * w;
          }
        }

        const idx = getIdx(x, y);
        out[idx]     = clamp255(data[idx]     + amount * (data[idx]     - br));
        out[idx + 1] = clamp255(data[idx + 1] + amount * (data[idx + 1] - bg));
        out[idx + 2] = clamp255(data[idx + 2] + amount * (data[idx + 2] - bb));
        out[idx + 3] = data[idx + 3];
      }
    }

    // borders copy
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          const idx = (y * width + x) * 4;
          out[idx] = data[idx];
          out[idx + 1] = data[idx + 1];
          out[idx + 2] = data[idx + 2];
          out[idx + 3] = data[idx + 3];
        }
      }
    }

    imgData.data.set(out);
    return imgData;
  }

  async function preprocessImageForOcr(file, maxSide = 1400, quality = 0.9) {
    const img = new Image();
    const url = URL.createObjectURL(file);

    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });

      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) return file;

      const scale = Math.min(1, maxSide / Math.max(w, h));
      const nw = Math.round(w * scale);
      const nh = Math.round(h * scale);

      const canvas = document.createElement("canvas");
      canvas.width = nw;
      canvas.height = nh;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, nw, nh);

      // grayscale + contrast
      const imgData = ctx.getImageData(0, 0, nw, nh);
      const d = imgData.data;

      const contrast = 1.25;
      const intercept = 128 * (1 - contrast);

      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        y = clamp255(y * contrast + intercept);
        d[i] = d[i + 1] = d[i + 2] = y;
      }

      sharpenImageData(imgData, 0.55);

      // light threshold
      const t = 170;
      for (let i = 0; i < d.length; i += 4) {
        const y = d[i];
        const v = y > t ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }

      ctx.putImageData(imgData, 0, 0);

      const blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
      });

      if (!blob) return file;
      return new File([blob], "ocr_preprocessed.jpg", { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function runOcrOnFile(file) {
    if (!file) return;

    ocrUxShow();
    vibrate([30]); // start

    try {
      setOcrStatus("Rasm tayyorlanmoqda...");
      ocrUxSetProgress(2, "Preparing image...");

      const processed = await preprocessImageForOcr(file);

      setOcrStatus("OCR boshlanmoqda...");
      ocrUxSetProgress(8, "Loading OCR engine...");

      const worker = await Tesseract.createWorker({
        logger: (m) => {
          if (m?.status && typeof m?.progress === "number") {
            const pct = Math.round(m.progress * 100);
            const mapped = 10 + Math.round(pct * 0.9);
            ocrUxSetProgress(mapped, `${m.status}... ${pct}%`);
            setOcrStatus(`${m.status}... ${pct}%`);
            if (pct === 25 || pct === 50 || pct === 75) vibrate([15]);
          } else if (m?.status) {
            setOcrStatus(`${m.status}...`);
          }
        }
      });

      try {
        await worker.load();
        await worker.loadLanguage("eng");
        await worker.initialize("eng");
        await worker.setParameters({ tessedit_pageseg_mode: "6" });

        const { data } = await worker.recognize(processed);
        const text = data?.text || "";

        const words = extractWordsFromText(text);
        extractedWords = words;
        renderWords();

        ocrUxSetProgress(100, `Done. Words: ${words.length}`);
        setOcrStatus(`OCR tugadi. Topildi: ${words.length} ta so‘z.`);
        vibrate([30, 30, 30]);
      } finally {
        await worker.terminate();
      }
    } catch (e) {
      setOcrStatus(`OCR xato: ${e?.message || "unknown"}`);
      ocrUxSetProgress(0, "Failed");
      vibrate([120, 60, 120]);
    } finally {
      setTimeout(() => ocrUxHide(), 800);
    }
  }

  // --- Translation (EN→UZ) - best-effort
  // Uses MyMemory public API (rate-limited). If fails -> empty string.
  async function translateWordEnUz(word) {
    const q = encodeURIComponent(word);
    const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|uz`;

    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) return "";
      const json = await res.json();
      const t = json?.responseData?.translatedText;
      if (!t || typeof t !== "string") return "";
      return t.trim();
    } catch {
      return "";
    }
  }

  async function mapLimit(items, limit, asyncFn) {
    const results = new Array(items.length);
    let i = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await asyncFn(items[idx], idx);
      }
    });

    await Promise.all(runners);
    return results;
  }

  // --- DB: load chats
  async function loadChats() {
    if (!sessionUser) return;

    const { data, error } = await supabase
      .from("vocab_chats")
      .select("id, title, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      chatList.textContent = `Xato: ${error.message}`;
      return;
    }

    chats = data || [];
    renderChatList();
  }

  function renderChatList() {
    if (!sessionUser) {
      chatList.textContent = "Sign in qiling — chatlar shu yerda chiqadi.";
      return;
    }

    if (!chats.length) {
      chatList.textContent = "Hozircha chat yo‘q. OCR qiling va chat yarating.";
      return;
    }

    chatList.innerHTML = "";
    chats.forEach((c) => {
      const item = document.createElement("div");
      item.className = "chat-item";

      const row1 = document.createElement("div");
      row1.className = "chat-row";

      const title = document.createElement("div");
      title.className = "chat-title";
      title.textContent = c.title || "Untitled chat";

      const meta = document.createElement("div");
      meta.className = "chat-meta";
      meta.textContent = new Date(c.created_at).toLocaleString();

      row1.appendChild(title);
      row1.appendChild(meta);

      const row2 = document.createElement("div");
      row2.className = "chat-row";

      const actions = document.createElement("div");
      actions.className = "chat-actions";

      const openBtn = document.createElement("button");
      openBtn.className = "btn btn-secondary";
      openBtn.type = "button";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () => openChat(c));

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-ghost";
      delBtn.type = "button";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => deleteChat(c.id));

      actions.appendChild(openBtn);
      actions.appendChild(delBtn);

      row2.appendChild(actions);

      item.appendChild(row1);
      item.appendChild(row2);
      chatList.appendChild(item);
    });
  }

  async function deleteChat(chatId) {
    if (!sessionUser) return;

    if (!confirm("Chat o‘chirilsinmi?")) return;

    const { error } = await supabase.from("vocab_chats").delete().eq("id", chatId);
    if (error) {
      setCreateStatus(`Delete xato: ${error.message}`);
      return;
    }

    if (activeChat?.id === chatId) setActiveChat(null);
    await loadChats();
    setCreateStatus("Chat o‘chirildi.");
  }

  async function openChat(chat) {
    if (!sessionUser) return;

    setCreateStatus("");
    setOcrStatus("");

    activeChat = chat;
    setActiveChat(chat);

    const { data, error } = await supabase
      .from("vocab_cards")
      .select("id, en, uz, created_at")
      .eq("chat_id", chat.id)
      .order("created_at", { ascending: true });

    if (error) {
      cards = [];
      currentIndex = 0;
      renderCard();
      cardsList.textContent = `Xato: ${error.message}`;
      return;
    }

    cards = data || [];
    currentIndex = 0;
    renderCard();
    renderCardsList();
  }

  function setActiveChat(chat) {
    activeChat = chat;
    if (!chat) {
      activeChatTitle.textContent = "Flashcards";
      activeChatMeta.textContent = "—";
      cards = [];
      currentIndex = 0;
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

    if (!cards.length) {
      cardsList.textContent = "Bu chatda card yo‘q.";
      return;
    }

    const lines = cards.map((c, i) => `${i + 1}. ${c.en}  →  ${c.uz || "(uz tarjima yo‘q)"}`);
    cardsList.textContent = lines.join("\n");
  }

  // --- Flashcard display
  function showFront() {
    cardBack.classList.add("hidden");
    cardFront.classList.remove("hidden");
  }

  function showBack() {
    cardFront.classList.add("hidden");
    cardBack.classList.remove("hidden");
  }

  function renderCard() {
    if (!activeChat) {
      showFront();
      frontText.textContent = "Chat tanlang yoki yaratib oling.";
      backText.textContent = "—";
      exampleText.textContent = "";
      return;
    }

    if (!cards.length) {
      showFront();
      frontText.textContent = "Bu chatda card yo‘q.";
      backText.textContent = "—";
      exampleText.textContent = "";
      return;
    }

    const c = cards[currentIndex];
    showFront();
    frontText.textContent = c.en || "—";
    backText.textContent = c.uz || "—";
    exampleText.textContent = "";
  }

  // --- Create chat (OCR words -> translate -> insert)
  async function createChatFromWords() {
    if (!sessionUser) {
      setCreateStatus("Avval Sign in qiling.");
      return;
    }

    if (!extractedWords.length) {
      setCreateStatus("Avval OCR qiling yoki so‘z qo‘shing.");
      return;
    }

    // reload chats count (server truth)
    const { data: existing, error: countErr } = await supabase
      .from("vocab_chats")
      .select("id", { count: "exact" });

    if (countErr) {
      setCreateStatus(`Xato: ${countErr.message}`);
      return;
    }

    const count = existing?.length || 0;
    if (count >= 2) {
      setCreateStatus("Limit: har foydalanuvchiga 2 tagacha chat mumkin.");
      return;
    }

    const title = (chatTitle.value || "").trim() || "Reading chat";
    setCreateStatus("Tarjima qilinyapti...");

    // Translate with concurrency limit
    const translations = await mapLimit(extractedWords, 4, async (w) => {
      const t = await translateWordEnUz(w);
      return { en: w, uz: t };
    });

    // Create chat row
    setCreateStatus("Chat yaratilmoqda...");
    const { data: chatRow, error: chatErr } = await supabase
      .from("vocab_chats")
      .insert({ user_id: sessionUser.id, title })
      .select("id, title, created_at")
      .single();

    if (chatErr) {
      setCreateStatus(`Chat xato: ${chatErr.message}`);
      return;
    }

    // Insert cards
    setCreateStatus("Cardlar saqlanyapti...");
    const cardRows = translations.map((x) => ({
      user_id: sessionUser.id,
      chat_id: chatRow.id,
      en: x.en,
      uz: x.uz || "",
    }));

    const { error: cardsErr } = await supabase.from("vocab_cards").insert(cardRows);
    if (cardsErr) {
      setCreateStatus(`Card save xato: ${cardsErr.message}`);
      return;
    }

    setCreateStatus("✅ Tayyor. Chat yaratildi.");
    extractedWords = [];
    renderWords();
    chatTitle.value = "";

    await loadChats();
    // open newly created chat (it will be first due to order desc)
    const newChat = chats.find((c) => c.id === chatRow.id) || chatRow;
    await openChat(newChat);
  }

  // --- Export / Import
  function exportActiveChat() {
    if (!activeChat) {
      alert("Avval chat tanlang.");
      return;
    }

    const payload = {
      title: activeChat.title || "Untitled chat",
      created_at: activeChat.created_at,
      cards: (cards || []).map((c) => ({ en: c.en, uz: c.uz || "" })),
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

  async function importChatFromFile(file) {
    if (!sessionUser) {
      alert("Avval Sign in qiling.");
      return;
    }

    // count chats
    const { data: existing, error: countErr } = await supabase
      .from("vocab_chats")
      .select("id");

    if (countErr) {
      alert(`Xato: ${countErr.message}`);
      return;
    }
    if ((existing?.length || 0) >= 2) {
      alert("Limit: har foydalanuvchiga 2 tagacha chat mumkin.");
      return;
    }

    const txt = await file.text();
    let json;
    try { json = JSON.parse(txt); } catch { alert("JSON noto‘g‘ri."); return; }

    const title = (json?.title || "Imported chat").toString().slice(0, 120);
    const list = Array.isArray(json?.cards) ? json.cards : [];

    if (!list.length) {
      alert("JSON ichida cards yo‘q.");
      return;
    }

    setCreateStatus("Import: chat yaratilmoqda...");
    const { data: chatRow, error: chatErr } = await supabase
      .from("vocab_chats")
      .insert({ user_id: sessionUser.id, title })
      .select("id, title, created_at")
      .single();

    if (chatErr) { setCreateStatus(`Import chat xato: ${chatErr.message}`); return; }

    setCreateStatus("Import: cardlar saqlanyapti...");
    const cardRows = list.map((c) => ({
      user_id: sessionUser.id,
      chat_id: chatRow.id,
      en: (c?.en || "").toString(),
      uz: (c?.uz || "").toString(),
    })).filter((r) => r.en.trim().length > 0);

    const { error: cardsErr } = await supabase.from("vocab_cards").insert(cardRows);
    if (cardsErr) { setCreateStatus(`Import cards xato: ${cardsErr.message}`); return; }

    setCreateStatus("✅ Import tugadi.");
    await loadChats();
    const newChat = chats.find((c) => c.id === chatRow.id) || chatRow;
    await openChat(newChat);
  }

  // --- Wire events
  signOutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
    setSignedOutUI();
  });

  runOcrBtn.addEventListener("click", async () => {
    setOcrStatus("");
    setCreateStatus("");
    const f = imageInput.files?.[0];
    if (!f) {
      setOcrStatus("Avval rasm tanlang.");
      return;
    }
    await runOcrOnFile(f);
  });

  clearScanBtn.addEventListener("click", () => {
    imageInput.value = "";
    extractedWords = [];
    renderWords();
    setOcrStatus("");
    setCreateStatus("");
    ocrUxHide();
  });

  addManualWordBtn.addEventListener("click", () => {
    const w = normalizeWord(manualWord.value);
    if (!w) return;
    if (!extractedWords.includes(w)) extractedWords.push(w);
    manualWord.value = "";
    renderWords();
  });

  manualWord.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addManualWordBtn.click();
    }
  });

  createChatBtn.addEventListener("click", async () => {
    setCreateStatus("");
    await createChatFromWords();
  });

  card.addEventListener("click", () => {
    // flip by toggling hidden (no "flip" label needed)
    if (cardBack.classList.contains("hidden")) showBack();
    else showFront();
  });

  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.click();
    }
  });

  prevBtn.addEventListener("click", () => {
    if (!cards.length) return;
    currentIndex = (currentIndex - 1 + cards.length) % cards.length;
    renderCard();
  });

  nextBtn.addEventListener("click", () => {
    if (!cards.length) return;
    currentIndex = (currentIndex + 1) % cards.length;
    renderCard();
  });

  exportBtn.addEventListener("click", () => exportActiveChat());

  importBtn.addEventListener("click", () => {
    importFile.value = "";
    importFile.click();
  });

  importFile.addEventListener("change", async () => {
    const f = importFile.files?.[0];
    if (!f) return;
    await importChatFromFile(f);
  });

  // --- Init
  (async () => {
    await refreshSessionAndUI();
    renderWords();
    renderCard();

    if (sessionUser) {
      await loadChats();
    }
  })();

  // Keep UI synced with auth state
  supabase.auth.onAuthStateChange(async (_event, session) => {
    const user = session?.user || null;
    if (!user) {
      setSignedOutUI();
      return;
    }
    setSignedInUI(user);
    await loadChats();
  });
});
