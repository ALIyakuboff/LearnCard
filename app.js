/* ===========
  app.js (SERVER OCR)
  - OCR: Cloudflare Worker (fast) -> OCR.space
  - Image not stored (only sent for OCR request)
  - Extract words -> EN→UZ translate -> create chat (max 2 enforced by DB trigger)
  - Per-user data via Supabase RLS
=========== */

document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.APP_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || "";
  const OCR_WORKER_URL = cfg.OCR_WORKER_URL || "";

  const el = (id) => document.getElementById(id);
  const setText = (node, text) => { if (node) node.textContent = text ?? ""; };
  const safeTrim = (s) => (s || "").trim();

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

  // Status helpers
  function setOcrStatus(msg) { setText(ocrStatus, msg); }
  function setCreateStatus(msg) { setText(createStatus, msg); }

  function ocrUxShow() {
    ocrUx?.classList.remove("hidden");
    if (ocrProgressBar) ocrProgressBar.style.width = "0%";
    if (ocrProgressText) ocrProgressText.textContent = "Starting...";
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

  // Supabase init
  if (!SUPABASE_URL.startsWith("https://") || SUPABASE_ANON_KEY.length < 10) {
    setText(userLine, "Supabase config noto‘g‘ri. config.js ni tekshiring.");
    return;
  }
  if (!OCR_WORKER_URL.startsWith("https://")) {
    setOcrStatus("OCR worker URL noto‘g‘ri. config.js -> OCR_WORKER_URL ni tekshiring.");
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // State
  let sessionUser = null;
  let extractedWords = [];
  let chats = [];
  let activeChat = null;
  let cards = [];
  let currentIndex = 0;

  // Auth UI
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
    if (!user) { setSignedOutUI(); return; }
    setSignedInUI(user);
  }

  // Words
  function normalizeWord(w) {
    return (w || "").trim().toLowerCase().replace(/[^a-z']/g, "");
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

    return out.slice(0, 150); // cap
  }

  // SERVER OCR
  async function runServerOcr(file) {
    if (!OCR_WORKER_URL.startsWith("https://")) {
      setOcrStatus("OCR worker URL yo‘q. config.js ni tekshiring.");
      return;
    }

    ocrUxShow();
    vibrate([20]);

    try {
      setOcrStatus("Uploading image (not stored)...");
      ocrUxSetProgress(15, "Uploading...");

      const fd = new FormData();
      fd.append("image", file);

      const res = await fetch(OCR_WORKER_URL, {
        method: "POST",
        body: fd,
      });

      ocrUxSetProgress(55, "OCR on server...");

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setOcrStatus(`OCR server error: ${json?.error || res.status}`);
        if (json?.providerMessage) setOcrStatus(`OCR server error: ${json.error} (${json.providerMessage})`);
        ocrUxSetProgress(0, "Failed");
        vibrate([120, 60, 120]);
        return;
      }

      const text = json?.text || "";
      if (!text.trim()) {
        setOcrStatus("OCR natija bo‘sh. Rasm tiniqroq bo‘lsin yoki matnga yaqinroq oling.");
        ocrUxSetProgress(100, "Done (empty)");
        return;
      }

      const words = extractWordsFromText(text);

      extractedWords = words;
      renderWords();

      setOcrStatus(`Done. Words: ${words.length}`);
      ocrUxSetProgress(100, `Done. ${words.length} words`);
      vibrate([20, 20, 20]);
    } catch (e) {
      setOcrStatus(`OCR error: ${e?.message || "unknown"}`);
      ocrUxSetProgress(0, "Failed");
      vibrate([120, 60, 120]);
    } finally {
      setTimeout(() => ocrUxHide(), 600);
    }
  }

  // Translation EN→UZ
  async function translateWordEnUz(word) {
    const q = encodeURIComponent(word);
    const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|uz`;
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) return "";
      const json = await res.json();
      const t = json?.responseData?.translatedText;
      return typeof t === "string" ? t.trim() : "";
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

  // DB: chats/cards
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

  async function createChatFromWords() {
    if (!sessionUser) { setCreateStatus("Avval Sign in qiling."); return; }
    if (!extractedWords.length) { setCreateStatus("Avval OCR qiling yoki so‘z qo‘shing."); return; }

    const { data: existing, error: countErr } = await supabase.from("vocab_chats").select("id");
    if (countErr) { setCreateStatus(`Xato: ${countErr.message}`); return; }
    if ((existing?.length || 0) >= 2) { setCreateStatus("Limit: 2 ta chat."); return; }

    const title = safeTrim(chatTitle.value) || "Reading chat";
    setCreateStatus("Tarjima qilinyapti...");

    const translations = await mapLimit(extractedWords, 5, async (w) => {
      const t = await translateWordEnUz(w);
      return { en: w, uz: t };
    });

    setCreateStatus("Chat yaratilmoqda...");
    const { data: chatRow, error: chatErr } = await supabase
      .from("vocab_chats")
      .insert({ user_id: sessionUser.id, title })
      .select("id, title, created_at")
      .single();

    if (chatErr) { setCreateStatus(`Chat xato: ${chatErr.message}`); return; }

    setCreateStatus("Cardlar saqlanyapti...");
    const cardRows = translations.map((x) => ({
      user_id: sessionUser.id,
      chat_id: chatRow.id,
      en: x.en,
      uz: x.uz || "",
    }));

    const { error: cardsErr } = await supabase.from("vocab_cards").insert(cardRows);
    if (cardsErr) { setCreateStatus(`Card save xato: ${cardsErr.message}`); return; }

    setCreateStatus("✅ Tayyor. Chat yaratildi.");
    extractedWords = [];
    renderWords();
    chatTitle.value = "";

    await loadChats();
    const newChat = chats.find((c) => c.id === chatRow.id) || chatRow;
    await openChat(newChat);
  }

  function exportActiveChat() {
    if (!activeChat) { alert("Avval chat tanlang."); return; }
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
    if (!sessionUser) { alert("Avval Sign in qiling."); return; }

    const { data: existing, error: countErr } = await supabase.from("vocab_chats").select("id");
    if (countErr) { alert(`Xato: ${countErr.message}`); return; }
    if ((existing?.length || 0) >= 2) { alert("Limit: 2 ta chat."); return; }

    const txt = await file.text();
    let json;
    try { json = JSON.parse(txt); } catch { alert("JSON noto‘g‘ri."); return; }

    const title = (json?.title || "Imported chat").toString().slice(0, 120);
    const list = Array.isArray(json?.cards) ? json.cards : [];
    if (!list.length) { alert("JSON ichida cards yo‘q."); return; }

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

  // Events
  signOutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
    setSignedOutUI();
  });

  runOcrBtn.addEventListener("click", async () => {
    setOcrStatus("");
    setCreateStatus("");
    if (!sessionUser) {
      setOcrStatus("Avval Sign in qiling.");
      return;
    }
    const f = imageInput.files?.[0];
    if (!f) { setOcrStatus("Avval rasm tanlang."); return; }
    await runServerOcr(f);
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

  // Init
  (async () => {
    await refreshSessionAndUI();
    renderWords();
    renderCard();
    if (sessionUser) await loadChats();
  })();

  // Sync auth state
  supabase.auth.onAuthStateChange(async (_event, session) => {
    const user = session?.user || null;
    if (!user) { setSignedOutUI(); return; }
    setSignedInUI(user);
    await loadChats();
  });

  // Helpers used above
  async function runServerOcr(file) {
    if (!OCR_WORKER_URL.startsWith("https://")) {
      setOcrStatus("OCR worker URL yo‘q. config.js ni tekshiring.");
      return;
    }

    ocrUxShow();
    vibrate([20]);

    try {
      setOcrStatus("Uploading image (not stored)...");
      ocrUxSetProgress(15, "Uploading...");

      const fd = new FormData();
      fd.append("image", file);

      const res = await fetch(OCR_WORKER_URL, { method: "POST", body: fd });
      ocrUxSetProgress(60, "OCR on server...");

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOcrStatus(`OCR server error: ${json?.error || res.status}`);
        ocrUxSetProgress(0, "Failed");
        vibrate([120, 60, 120]);
        return;
      }

      const text = (json?.text || "").trim();
      if (!text) {
        setOcrStatus("OCR natija bo‘sh. Rasm tiniqroq bo‘lsin yoki matnga yaqinroq oling.");
        ocrUxSetProgress(100, "Done (empty)");
        return;
      }

      const words = extractWordsFromText(text);
      extractedWords = words;
      renderWords();

      setOcrStatus(`Done. Words: ${words.length}`);
      ocrUxSetProgress(100, `Done. ${words.length} words`);
      vibrate([20, 20, 20]);
    } catch (e) {
      setOcrStatus(`OCR error: ${e?.message || "unknown"}`);
      ocrUxSetProgress(0, "Failed");
      vibrate([120, 60, 120]);
    } finally {
      setTimeout(() => ocrUxHide(), 600);
    }
  }
});
