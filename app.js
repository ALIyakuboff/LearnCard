// app.js — FULL FINAL (Logout + JPG/PNG safe + E301 retry + OCR+Translate via Worker + RLS-safe chat limit)

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

  // State
  let sessionUser = null;

  let extractedWords = [];
  let translationMap = new Map();

  let chats = [];
  let activeChat = null;
  let activeCards = [];
  let cardIndex = 0;

  // Utilities
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

  // ✅ JPG/PNG safe conversion (reduces OCR provider issues)
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

      // Try JPEG first
      const jpegBlob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", jpegQuality);
      });
      if (jpegBlob) return new File([jpegBlob], "ocr.jpg", { type: "image/jpeg" });

      // Fallback PNG
      const pngBlob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/png");
      });
      if (pngBlob) return new File([pngBlob], "ocr.png", { type: "image/png" });

      return originalFile;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Auth UI
  function setSignedOutUI() {
    sessionUser = null;

    userLine.textContent = "Sign in qiling.";
    if (accountLabel) {
      accountLabel.classList.add("hidden");
      accountLabel.textContent = "";
    }

    if (signInBtn) signInBtn.classList.remove("hidden");
    if (signUpBtn) signUpBtn.classList.remove("hidden");
    if (signOutBtn) signOutBtn.classList.add("hidden");

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
    if (accountLabel) {
      accountLabel.textContent = user?.email || "signed-in";
      accountLabel.classList.remove("hidden");
    }

    if (signInBtn) signInBtn.classList.add("hidden");
    if (signUpBtn) signUpBtn.classList.add("hidden");
    if (signOutBtn) signOutBtn.classList.remove("hidden");

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
    if (!user) return setSignedOutUI();
    setSignedInUI(user);
  }

  // Logout (works)
  async function doLogout() {
    setCreateStatus("");
    setOcrStatus("");
    try {
      await supabase.auth.signOut();
    } catch (e) {
      // even if error, reset UI
    }
    setSignedOutUI();
  }

  // Words chips
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

  // RLS-safe chat count
  async function getChatCountRlsSafe() {
    const resp = await withTimeout(
      supabase.from("vocab_chats").select("*", { count: "exact", head: true }),
      8000,
      "chat count"
    );
    if (resp.error) throw resp.error;
    return resp.count || 0;
  }

  // OCR+Translate via Worker (single endpoint returns {text, words, pairs})
  async function runServerOcr(file) {
    if (!sessionUser) return setOcrStatus("Avval Sign in qiling.");
    if (!OCR_WORKER_URL.startsWith("https://")) return setOcrStatus("Worker URL yo‘q.");

    ocrUxShow();
    setOcrStatus("Preparing image (JPG/PNG safe)...");
    ocrUxSetProgress(10, "Preparing...");

    try {
      const fixedFile = await toSafeImageFile(file);

      setOcrStatus("Uploading image (not stored)...");
      ocrUxSetProgress(25, "Uploading...");

      const fd = new FormData();
      fd.append("image", fixedFile, fixedFile.name);

      // retry for E301 once
      let json = {};
      let lastErr = "";

      for (let attempt = 1; attempt <= 2; attempt++) {
        ocrUxSetProgress(55, `OCR server... (try ${attempt}/2)`);
        const res = await fetch(OCR_WORKER_URL, { method: "POST", body: fd });
        json = await res.json().catch(() => ({}));

        if (res.ok) {
          lastErr = "";
          break;
        }

        const msg = json?.error ? String(json.error) : `HTTP ${res.status}`;
        const prov = json?.providerMessage ? ` (${json.providerMessage})` : "";
        lastErr = `${msg}${prov}`;

        if (msg.includes("OCR provider error") && prov.includes("E301") && attempt === 1) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        break;
      }

      if (lastErr) {
        setOcrStatus(`Server error: ${lastErr}`);
        if (lastErr.includes("E301")) {
          setOcrStatus("E301: OCR.space rasmni qabul qilmadi. Screenshot qilib yoki JPG/PNG qilib qayta yuboring.");
        }
        ocrUxSetProgress(0, "Failed");
        return;
      }

      const text = (json?.text || "").trim();
      let words = Array.isArray(json?.words) ? json.words : [];

      // fallback: if worker didn't return words but has text
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
      setOcrStatus(`Done. Words: ${extractedWords.length}`);
      ocrUxSetProgress(100, `Done. ${extractedWords.length} words`);
    } catch (e) {
      setOcrStatus(`OCR error: ${String(e?.message || e)}`);
      ocrUxSetProgress(0, "Failed");
    } finally {
      setTimeout(() => ocrUxHide(), 600);
    }
  }

  // Chats
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

    if (chats.length > 0) await openChat(chats[0]);
    else setActiveChat(null);
  }

  function renderChatList() {
    if (!sessionUser) return;

    if (!chats.length) {
      if (chatList) chatList.textContent = "Hozircha chat yo‘q.";
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

    cardsList.textContent = activeCards.map((c, i) => `${i + 1}. ${c.en} → ${c.uz || ""}`).join("\n");
  }

  function showFront() { cardBack.classList.add("hidden"); cardFront.classList.remove("hidden"); }
  function showBack() { cardFront.classList.add("hidden"); cardBack.classList.remove("hidden"); }

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

  // Create chat (RLS-safe)
  async function createChatFromWords() {
    if (!sessionUser) return setCreateStatus("Avval Sign in qiling.");
    if (!extractedWords.length) return setCreateStatus("So‘zlar yo‘q. Avval Scan qiling.");

    createChatBtn.disabled = true;

    try {
      setCreateStatus("Chat limiti tekshirilmoqda...");
      const cnt = await getChatCountRlsSafe();
      if (cnt >= 2) {
        setCreateStatus("Limit: 2 ta chat. Avval bittasini o‘chiring.");
        return;
      }

      const title = safeTrim(chatTitle.value) || `Reading chat ${new Date().toLocaleString()}`;
      const words = extractedWords.slice(0, 100);

      setCreateStatus("Chat yaratilmoqda...");
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

      setCreateStatus("Cardlar saqlanyapti...");
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

      setCreateStatus(`✅ Tayyor. Chat yaratildi (${words.length} ta so‘z).`);

      extractedWords = [];
      translationMap = new Map();
      renderWords();
      chatTitle.value = "";

      await loadChats();
      await openChat(chats.find((c) => c.id === chatRow.id) || chatRow);
    } catch (e) {
      setCreateStatus(`Xato: ${e.message || e}`);
    } finally {
      createChatBtn.disabled = false;
    }
  }

  // Export (simple)
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

  /* =========================
     Events
  ========================= */

  if (signOutBtn) signOutBtn.addEventListener("click", doLogout);

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
    if (e.key === "Enter") { e.preventDefault(); addManualWordBtn?.click(); }
  });

  if (createChatBtn) createChatBtn.addEventListener("click", createChatFromWords);

  if (card) card.addEventListener("click", () => {
    if (cardBack.classList.contains("hidden")) showBack(); else showFront();
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

  if (exportBtn) exportBtn.addEventListener("click", exportActiveChat);

  if (importBtn) importBtn.addEventListener("click", () => {
    if (importFile) {
      importFile.value = "";
      importFile.click();
    }
  });

  if (importFile) importFile.addEventListener("change", async () => {
    setCreateStatus("Import ixtiyoriy (keyin qo‘shamiz).");
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
