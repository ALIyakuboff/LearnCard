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

  // Status helpers
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

  // Guardrails
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

  // App state
  let sessionUser = null;

  // extracted words (EN)
  let extractedWords = [];
  // translations (EN -> UZ)
  let translationMap = new Map();

  let chats = [];
  let activeChat = null;

  let activeCards = [];
  let cardIndex = 0;

  /* =========================
     Utilities
  ========================= */

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

  async function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`${label} timeout (${ms}ms)`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(t);
    }
  }

  /* =========================
     Auth UI
  ========================= */

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
    translationMap = new Map();
    renderWords();

    setOcrStatus("");
    setCreateStatus("");
  }

  function setSignedInUI(user) {
    sessionUser = user;

    userLine.textContent = "Kirgansiz.";
    accountLabel.textContent = user?.email || "signed-in";
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

  /* =========================
     Words chips (click to delete)
  ========================= */

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

  /* =========================
     OCR + Translate (single call)
     Worker returns: { text, words, pairs }
  ========================= */

  async function runServerOcr(file) {
    if (!sessionUser) return setOcrStatus("Avval Sign in qiling.");
    if (!OCR_WORKER_URL.startsWith("https://")) return setOcrStatus("OCR worker URL yo‘q.");

    ocrUxShow();
    setOcrStatus("Uploading image (not stored)...");
    ocrUxSetProgress(20, "Uploading...");

    try {
      const fd = new FormData();
      fd.append("image", file);

      ocrUxSetProgress(55, "OCR + Translate on server...");
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

      // Fallback: if worker didn't return words but text exists
      if (words.length === 0 && text) {
        words = extractWordsFromText(text);
      }

      extractedWords = words.map(normalizeWord).filter(Boolean).slice(0, 100);

      translationMap = new Map();
      const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
      for (const p of pairs) {
        const en = normalizeWord(p?.en);
        if (!en) continue;
        const uz = typeof p?.uz === "string" ? p.uz : "";
        translationMap.set(en, uz);
      }

      renderWords();
      setOcrStatus(`Done. Words: ${extractedWords.length} | textChars: ${text.length}`);
      ocrUxSetProgress(100, `Done. ${extractedWords.length} words`);
    } catch (e) {
      setOcrStatus(`OCR error: ${String(e?.message || e)}`);
      ocrUxSetProgress(0, "Failed");
    } finally {
      setTimeout(() => ocrUxHide(), 600);
    }
  }

  /* =========================
     Supabase helpers
  ========================= */

  async function getChatCountRlsSafe() {
    // RLS-safe count + no hang
    const p = supabase.from("vocab_chats").select("*", { count: "exact", head: true });
    const resp = await withTimeout(p, 8000, "chat count");
    if (resp.error) throw resp.error;
    return resp.count || 0;
  }

  async function loadChats() {
    if (!sessionUser) return;

    const { data, error } = await supabase
      .from("vocab_chats")
      .select("id, title, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      chatList.textContent = `Chats error: ${error.message}`;
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
    if (!sessionUser) return;

    if (!chats.length) {
      chatList.textContent = "Hozircha chat yo‘q.";
      return;
    }

    chatList.innerHTML = "";
    chats.forEach((c) => {
      const item = document.createElement("div");
      item.className = "chat-item";
      item.textContent = c.title || "Untitled chat";
      item.addEventListener("click", () => openChat(c));
      chatList.appendChild(item);
    });
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

  /* =========================
     Create Chat (robust)
  ========================= */

  async function createChatFromWords() {
    if (!sessionUser) return setCreateStatus("Avval Sign in qiling.");
    if (!extractedWords.length) return setCreateStatus("So‘zlar yo‘q. Avval Scan qiling.");

    createChatBtn.disabled = true;

    try {
      setCreateStatus("1/4 Chat limiti tekshirilmoqda...");
      const cnt = await getChatCountRlsSafe();
      if (cnt >= 2) {
        setCreateStatus("❌ Limit: 2 ta chat. Avval bittasini o‘chiring.");
        return;
      }

      const title = safeTrim(chatTitle.value) || `Reading chat ${new Date().toLocaleString()}`;
      const words = extractedWords.slice(0, 100);

      setCreateStatus("2/4 Chat yaratilmoqda...");
      const chatInsert = await withTimeout(
        supabase.from("vocab_chats")
          .insert({ user_id: sessionUser.id, title })
          .select("id, title, created_at")
          .single(),
        8000,
        "chat insert"
      );

      if (chatInsert.error) throw chatInsert.error;
      const chatRow = chatInsert.data;

      setCreateStatus("3/4 Cardlar saqlanyapti...");
      const cardRows = words.map((en) => ({
        user_id: sessionUser.id,
        chat_id: chatRow.id,
        en,
        uz: translationMap.get(en) || "",
      }));

      const cardsInsert = await withTimeout(
        supabase.from("vocab_cards").insert(cardRows),
        12000,
        "cards insert"
      );

      if (cardsInsert.error) throw cardsInsert.error;

      setCreateStatus(`4/4 ✅ Tayyor. Chat yaratildi (${words.length} ta so‘z).`);

      extractedWords = [];
      translationMap = new Map();
      renderWords();
      chatTitle.value = "";

      await loadChats();
      await openChat(chats.find((c) => c.id === chatRow.id) || chatRow);
    } catch (e) {
      setCreateStatus(`❌ Xato: ${e.message || e}`);
    } finally {
      createChatBtn.disabled = false;
    }
  }

  /* =========================
     Export / Import (optional)
  ========================= */

  function exportActiveChat() {
    if (!activeChat) return setCreateStatus("Export uchun avval chat tanlang.");
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

  /* =========================
     Events
  ========================= */

  signOutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
    setSignedOutUI();
  });

  runOcrBtn.addEventListener("click", async () => {
    const file = imageInput.files?.[0];
    if (!file) return setOcrStatus("Avval rasm tanlang.");
    await runServerOcr(file);
  });

  clearScanBtn.addEventListener("click", () => {
    imageInput.value = "";
    extractedWords = [];
    translationMap = new Map();
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
    if (e.key === "Enter") { e.preventDefault(); addManualWordBtn.click(); }
  });

  createChatBtn.addEventListener("click", createChatFromWords);

  card.addEventListener("click", () => {
    if (cardBack.classList.contains("hidden")) showBack(); else showFront();
  });

  prevBtn.addEventListener("click", () => {
    if (!activeCards.length) return;
    cardIndex = (cardIndex - 1 + activeCards.length) % activeCards.length;
    renderCard();
  });

  nextBtn.addEventListener("click", () => {
    if (!activeCards.length) return;
    cardIndex = (cardIndex + 1) % activeCards.length;
    renderCard();
  });

  exportBtn.addEventListener("click", exportActiveChat);

  importBtn.addEventListener("click", () => {
    importFile.value = "";
    importFile.click();
  });

  importFile.addEventListener("change", async () => {
    setCreateStatus("Import bu versiyada ixtiyoriy (keyin qo‘shamiz).");
  });

  /* =========================
     Init
  ========================= */

  (async () => {
    extractedWords = [];
    translationMap = new Map();
    renderWords();
    setActiveChat(null);

    await refreshSession();
    if (sessionUser) await loadChats();
  })();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    const user = session?.user || null;
    if (!user) return setSignedOutUI();
    setSignedInUI(user);
    await loadChats();
  });
});
