/* app.js — FULL (Server OCR + Server Translate + Create Chat + Supabase)
   - OCR: POST OCR_WORKER_URL (multipart image)
   - Translate: POST OCR_WORKER_URL/translate (json words[])
   - Chat limit: RLS-safe count/head:true
   - DB: vocab_chats + vocab_cards (en, uz, chat_id, user_id)
*/

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

  // Import/Export
  const exportBtn = el("exportBtn");
  const importBtn = el("importBtn");
  const importFile = el("importFile");
  const cardsList = el("cardsList");

  // ---------- Status helpers ----------
  function setOcrStatus(msg) { setText(ocrStatus, msg); }
  function setCreateStatus(msg) { setText(createStatus, msg); }

  function ocrUxShow() {
    if (!ocrUx) return;
    ocrUx.classList.remove("hidden");
    if (ocrProgressBar) ocrProgressBar.style.width = "0%";
    if (ocrProgressText) ocrProgressText.textContent = "Starting...";
  }
  function ocrUxHide() {
    if (!ocrUx) return;
    ocrUx.classList.add("hidden");
  }
  function ocrUxSetProgress(pct, text) {
    const p = Math.max(0, Math.min(100, pct));
    if (ocrProgressBar) ocrProgressBar.style.width = `${p}%`;
    if (ocrProgressText) ocrProgressText.textContent = text || `${p}%`;
  }

  // ---------- Guardrails ----------
  if (!SUPABASE_URL.startsWith("https://") || SUPABASE_ANON_KEY.length < 10) {
    setText(userLine, "Supabase config noto‘g‘ri. config.js ni tekshiring.");
    return;
  }
  if (!OCR_WORKER_URL.startsWith("https://")) {
    setOcrStatus("OCR Worker URL noto‘g‘ri. config.js -> OCR_WORKER_URL ni tekshiring.");
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // ---------- App state ----------
  let sessionUser = null;
  let extractedWords = [];
  let chats = [];
  let activeChat = null;
  let activeCards = [];
  let cardIndex = 0;

  // ---------- UI: auth ----------
  function setSignedOutUI() {
    sessionUser = null;

    userLine.textContent = "Sign in qiling.";
    accountLabel.classList.add("hidden");
    accountLabel.textContent = "";

    signInBtn.classList.remove("hidden");
    signUpBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");

    if (runOcrBtn) runOcrBtn.disabled = true;
    if (createChatBtn) createChatBtn.disabled = true;
    if (addManualWordBtn) addManualWordBtn.disabled = true;
    if (manualWord) manualWord.disabled = true;
    if (imageInput) imageInput.disabled = true;
    if (chatTitle) chatTitle.disabled = true;
    if (exportBtn) exportBtn.disabled = true;
    if (importBtn) importBtn.disabled = true;

    if (chatList) chatList.textContent = "Sign in qiling — chatlar shu yerda chiqadi.";
    setActiveChat(null);

    extractedWords = [];
    renderWords();
    setOcrStatus("");
    setCreateStatus("");
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

    if (runOcrBtn) runOcrBtn.disabled = false;
    if (createChatBtn) createChatBtn.disabled = false;
    if (addManualWordBtn) addManualWordBtn.disabled = false;
    if (manualWord) manualWord.disabled = false;
    if (imageInput) imageInput.disabled = false;
    if (chatTitle) chatTitle.disabled = false;
    if (exportBtn) exportBtn.disabled = false;
    if (importBtn) importBtn.disabled = false;
  }

  async function refreshSession() {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user || null;
    if (!user) {
      setSignedOutUI();
      return;
    }
    setSignedInUI(user);
  }

  // ---------- Words ----------
  function normalizeWord(w) {
    return (w || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z']/g, "");
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

  // ---------- OCR (server) ----------
  async function runServerOcr(file) {
    if (!OCR_WORKER_URL.startsWith("https://")) {
      setOcrStatus("OCR worker URL yo‘q. config.js ni tekshiring.");
      return;
    }
    if (!sessionUser) {
      setOcrStatus("Avval Sign in qiling.");
      return;
    }

    ocrUxShow();
    setOcrStatus("Uploading image (not stored)...");
    ocrUxSetProgress(15, "Uploading...");

    try {
      const fd = new FormData();
      fd.append("image", file);

      ocrUxSetProgress(35, "OCR server...");
      const res = await fetch(OCR_WORKER_URL, { method: "POST", body: fd });

      ocrUxSetProgress(70, "Parsing text...");
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = json?.error ? String(json.error) : `HTTP ${res.status}`;
        const prov = json?.providerMessage ? ` (${json.providerMessage})` : "";
        setOcrStatus(`OCR server error: ${msg}${prov}`);
        ocrUxSetProgress(0, "Failed");
        return;
      }

      const text = (json?.text || "").trim();
      if (!text) {
        setOcrStatus("OCR natija bo‘sh. Rasm tiniqroq bo‘lsin yoki matnga yaqinroq oling.");
        ocrUxSetProgress(100, "Done (empty)");
        extractedWords = [];
        renderWords();
        return;
      }

      const words = extractWordsFromText(text);
      extractedWords = words.slice(0, 120);
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

  // ---------- TRANSLATE VIA WORKER (NEW, 100% RELIABLE) ----------
  async function translateWordsViaWorker(words) {
    const url = `${OCR_WORKER_URL}/translate`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error ? String(json.error) : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
    return pairs; // [{en, uz}]
  }

  // ---------- DB helpers ----------
  async function loadChats() {
    if (!sessionUser) return;

    const { data, error } = await supabase
      .from("vocab_chats")
      .select("id, title, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      if (chatList) chatList.textContent = `Chats error: ${error.message}`;
      chats = [];
      return;
    }

    chats = data || [];
    renderChatList();

    if (chats.length > 0) {
      await openChat(chats[0]);
    } else {
      setActiveChat(null);
    }
  }

  function renderChatList() {
    if (!sessionUser) {
      if (chatList) chatList.textContent = "Sign in qiling — chatlar shu yerda chiqadi.";
      return;
    }

    if (!chats.length) {
      if (chatList) chatList.textContent = "Hozircha chat yo‘q. OCR qiling va chat yarating.";
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
      openBtn.addEventListener("click", async () => {
        await openChat(c);
      });

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-ghost";
      delBtn.type = "button";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", async () => {
        const ok = confirm("Chat o‘chirilsinmi? (max 2 limit bor)");
        if (!ok) return;
        await deleteChat(c.id);
      });

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

    const { error } = await supabase
      .from("vocab_chats")
      .delete()
      .eq("id", chatId);

    if (error) {
      setCreateStatus(`Delete error: ${error.message}`);
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
      activeCards = [];
      cardIndex = 0;
      renderCard();
      renderCardsList();
      setCreateStatus(`Load cards error: ${error.message}`);
      return;
    }

    activeCards = data || [];
    cardIndex = 0;
    renderCard();
    renderCardsList();
  }

  function setActiveChat(chat) {
    activeChat = chat;

    if (!chat) {
      if (activeChatTitle) activeChatTitle.textContent = "Flashcards";
      if (activeChatMeta) activeChatMeta.textContent = "—";
      activeCards = [];
      cardIndex = 0;
      renderCard();
      renderCardsList();
      return;
    }

    if (activeChatTitle) activeChatTitle.textContent = chat.title || "Untitled chat";
    if (activeChatMeta) activeChatMeta.textContent = "Active";
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

    const lines = activeCards.map((c, i) => `${i + 1}. ${c.en} → ${c.uz || "(tarjima yo‘q)"}`);
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
    if (!frontText || !backText) return;

    if (!activeChat) {
      showFront();
      frontText.textContent = "Chat tanlang yoki yarating.";
      backText.textContent = "—";
      if (exampleText) exampleText.textContent = "";
      return;
    }

    if (!activeCards.length) {
      showFront();
      frontText.textContent = "Bu chatda card yo‘q.";
      backText.textContent = "—";
      if (exampleText) exampleText.textContent = "";
      return;
    }

    const c = activeCards[cardIndex];
    showFront();
    frontText.textContent = c.en || "—";
    backText.textContent = c.uz || "—";
    if (exampleText) exampleText.textContent = "";
  }

  // ---------- Create chat (RLS-safe + Translate via Worker) ----------
  async function createChatFromWords() {
    if (!sessionUser) {
      setCreateStatus("Avval Sign in qiling.");
      return;
    }
    if (!extractedWords.length) {
      setCreateStatus("So‘zlar yo‘q. Avval OCR qiling.");
      return;
    }

    // ✅ RLS-safe count
    setCreateStatus("Chat limiti tekshirilmoqda...");
    const { count, error: countErr } = await supabase
      .from("vocab_chats")
      .select("*", { count: "exact", head: true });

    if (countErr) {
      setCreateStatus(`Xato (chat count): ${countErr.message}`);
      return;
    }
    if ((count || 0) >= 2) {
      setCreateStatus("Limit: 2 ta chat. Avval bittasini o‘chiring.");
      return;
    }

    // words cap
    const MAX_WORDS = 50;
    const words = extractedWords.slice(0, MAX_WORDS);

    const title = safeTrim(chatTitle.value) || `Reading chat ${new Date().toLocaleString()}`;

    // ✅ 1 request translate (worker)
    setCreateStatus("Tarjima qilinyapti (server)...");
    let translations;
    try {
      translations = await translateWordsViaWorker(words);
    } catch (e) {
      // fallback: still create chat with empty uz
      setCreateStatus("Tarjima xato. Baribir chat yaratiladi (UZ bo‘sh).");
      translations = words.map((w) => ({ en: w, uz: "" }));
    }

    // insert chat
    setCreateStatus("Chat yaratilmoqda...");
    const { data: chatRow, error: chatErr } = await supabase
      .from("vocab_chats")
      .insert({ user_id: sessionUser.id, title })
      .select("id, title, created_at")
      .single();

    if (chatErr) {
      setCreateStatus(`Xato (chat insert): ${chatErr.message}`);
      return;
    }

    // insert cards
    setCreateStatus("Cardlar saqlanyapti...");
    const cardRows = translations.map((x) => ({
      user_id: sessionUser.id,
      chat_id: chatRow.id,
      en: x.en,
      uz: x.uz || "",
    }));

    const { error: cardsErr } = await supabase
      .from("vocab_cards")
      .insert(cardRows);

    if (cardsErr) {
      setCreateStatus(`Xato (cards insert): ${cardsErr.message}`);
      return;
    }

    setCreateStatus(`✅ Tayyor. Chat yaratildi (words: ${translations.length}).`);

    extractedWords = [];
    renderWords();
    if (chatTitle) chatTitle.value = "";

    await loadChats();
    const newChat = chats.find((c) => c.id === chatRow.id) || chatRow;
    await openChat(newChat);
  }

  // ---------- Events ----------
  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      await supabase.auth.signOut();
      setSignedOutUI();
    });
  }

  if (runOcrBtn) {
    runOcrBtn.addEventListener("click", async () => {
      setOcrStatus("");
      setCreateStatus("");
      if (!sessionUser) {
        setOcrStatus("Avval Sign in qiling.");
        return;
      }
      const file = imageInput?.files?.[0];
      if (!file) {
        setOcrStatus("Avval rasm tanlang.");
        return;
      }
      await runServerOcr(file);
    });
  }

  if (clearScanBtn) {
    clearScanBtn.addEventListener("click", () => {
      if (imageInput) imageInput.value = "";
      extractedWords = [];
      renderWords();
      setOcrStatus("");
      setCreateStatus("");
      ocrUxHide();
    });
  }

  if (addManualWordBtn) {
    addManualWordBtn.addEventListener("click", () => {
      const w = normalizeWord(manualWord?.value);
      if (!w) return;
      if (!extractedWords.includes(w)) extractedWords.push(w);
      if (manualWord) manualWord.value = "";
      renderWords();
    });
  }

  if (manualWord) {
    manualWord.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addManualWordBtn?.click();
      }
    });
  }

  if (createChatBtn) {
    createChatBtn.addEventListener("click", async () => {
      await createChatFromWords();
    });
  }

  if (card) {
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
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (!activeCards.length) return;
      cardIndex = (cardIndex - 1 + activeCards.length) % activeCards.length;
      renderCard();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (!activeCards.length) return;
      cardIndex = (cardIndex + 1) % activeCards.length;
      renderCard();
    });
  }

  // export/import can remain as-is; you can still use your existing functions if present.
  if (exportBtn) exportBtn.addEventListener("click", exportActiveChat);

  if (importBtn) {
    importBtn.addEventListener("click", () => {
      if (importFile) {
        importFile.value = "";
        importFile.click();
      }
    });
  }

  if (importFile) {
    importFile.addEventListener("change", async () => {
      const f = importFile.files?.[0];
      if (!f) return;
      await importChatFromFile(f);
    });
  }

  // Dummy export/import (keeps buttons functional if you didn’t paste your older ones)
  function exportActiveChat() {
    if (!activeChat) {
      setCreateStatus("Export uchun avval chat tanlang.");
      return;
    }
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

  async function importChatFromFile(file) {
    setCreateStatus("Import hali ulangan emas (xohlasangiz sizning eski import funksiyangizni qo‘shamiz).");
  }

  // ---------- Init ----------
  (async () => {
    extractedWords = [];
    renderWords();
    setActiveChat(null);

    await refreshSession();
    if (sessionUser) await loadChats();
  })();

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
