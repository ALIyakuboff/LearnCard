/* ===========
  app.js
  - OCR in browser (no image upload/storage)
  - Extract words -> EN->UZ translate -> save as Chat (max 2 per user)
  - Each user sees only own chats/cards (RLS)
  - Flashcard view per selected chat
=========== */

const cfg = window.APP_CONFIG || {};
const SUPABASE_URL = cfg.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || "";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const el = (id) => document.getElementById(id);

const userLine = el("userLine");
const accountLabel = el("accountLabel");
const signInBtn = el("signInBtn");
const signUpBtn = el("signUpBtn");
const signOutBtn = el("signOutBtn");

const imageInput = el("imageInput");
const runOcrBtn = el("runOcrBtn");
const clearScanBtn = el("clearScanBtn");
const ocrStatus = el("ocrStatus");

const wordsChips = el("wordsChips");
const manualWord = el("manualWord");
const addManualWordBtn = el("addManualWordBtn");
const chatTitle = el("chatTitle");
const createChatBtn = el("createChatBtn");
const createStatus = el("createStatus");

const chatList = el("chatList");

const activeChatTitle = el("activeChatTitle");
const activeChatMeta = el("activeChatMeta");

const cardEl = el("card");
const frontTextEl = el("frontText");
const backTextEl = el("backText");
const exampleTextEl = el("exampleText");
const cardBackEl = el("cardBack");
const prevBtn = el("prevBtn");
const nextBtn = el("nextBtn");

const exportBtn = el("exportBtn");
const importBtn = el("importBtn");
const importFile = el("importFile");
const cardsList = el("cardsList");

let sessionUser = null;

let extractedWords = [];
let chats = [];
let activeChatId = null;
let activeCards = [];
let idx = 0;
let showAnswer = false;

// Minimal stopwords
const STOP = new Set([
  "the","a","an","and","or","but","to","of","in","on","at","for","with","from","by","as",
  "is","are","was","were","be","been","being","it","this","that","these","those","i","you","he","she","they","we",
  "my","your","his","her","their","our","me","him","them","us","not","no","yes","do","does","did","done","have","has","had",
]);

function safeTrim(s) { return (s || "").trim(); }
function setText(node, msg) { node.textContent = msg || ""; }

function setUIAuthed(isAuthed) {
  if (isAuthed) {
    signOutBtn.classList.remove("hidden");
    signInBtn.classList.add("hidden");
    signUpBtn.classList.add("hidden");

    accountLabel.classList.remove("hidden");
    accountLabel.textContent = sessionUser?.email || "Signed in";

    userLine.textContent = "Signed in";
    exportBtn.disabled = false;
    importBtn.disabled = false;

    runOcrBtn.disabled = false;
    createChatBtn.disabled = false;
    addManualWordBtn.disabled = false;
    manualWord.disabled = false;
    imageInput.disabled = false;
    chatTitle.disabled = false;
  } else {
    signOutBtn.classList.add("hidden");
    signInBtn.classList.remove("hidden");
    signUpBtn.classList.remove("hidden");

    accountLabel.classList.add("hidden");
    accountLabel.textContent = "";

    userLine.textContent = "Sign in qiling.";
    exportBtn.disabled = true;
    importBtn.disabled = true;

    runOcrBtn.disabled = true;
    createChatBtn.disabled = true;
    addManualWordBtn.disabled = true;
    manualWord.disabled = true;
    imageInput.disabled = true;
    chatTitle.disabled = true;
  }
}

function setOcrStatus(msg) { setText(ocrStatus, msg); }
function setCreateStatus(msg) { setText(createStatus, msg); }

function renderWords() {
  if (extractedWords.length === 0) {
    wordsChips.classList.add("muted");
    wordsChips.textContent = "Hozircha so‘z yo‘q.";
    return;
  }

  wordsChips.classList.remove("muted");
  wordsChips.innerHTML = "";

  for (const w of extractedWords) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = w;
    chip.title = "Remove";
    chip.addEventListener("click", () => {
      extractedWords = extractedWords.filter((x) => x !== w);
      renderWords();
    });
    wordsChips.appendChild(chip);
  }
}

function renderChats() {
  if (!sessionUser) {
    chatList.classList.add("muted");
    chatList.textContent = "Sign in qiling — chatlar shu yerda chiqadi.";
    return;
  }

  if (chats.length === 0) {
    chatList.classList.add("muted");
    chatList.textContent = "Hozircha chat yo‘q. Rasm yuklab yarating.";
    return;
  }

  chatList.classList.remove("muted");
  chatList.innerHTML = "";

  chats.forEach((c) => {
    const wrap = document.createElement("div");
    wrap.className = "chat-item";

    const row1 = document.createElement("div");
    row1.className = "chat-row";

    const title = document.createElement("div");
    title.className = "chat-title";
    title.textContent = c.title;

    const meta = document.createElement("div");
    meta.className = "chat-meta";
    meta.textContent = new Date(c.created_at).toLocaleString();

    row1.appendChild(title);
    row1.appendChild(meta);

    const row2 = document.createElement("div");
    row2.className = "chat-row";

    const btnOpen = document.createElement("button");
    btnOpen.className = "btn btn-secondary";
    btnOpen.type = "button";
    btnOpen.textContent = "Open";
    btnOpen.addEventListener("click", async () => {
      await openChat(c.id);
    });

    const btnDelete = document.createElement("button");
    btnDelete.className = "btn btn-ghost";
    btnDelete.type = "button";
    btnDelete.textContent = "Delete";
    btnDelete.addEventListener("click", async () => {
      const ok = confirm("Chat o‘chiriladi. Davom etasizmi?");
      if (!ok) return;
      await deleteChat(c.id);
    });

    const actions = document.createElement("div");
    actions.className = "chat-actions";
    actions.appendChild(btnOpen);
    actions.appendChild(btnDelete);

    row2.appendChild(document.createElement("div"));
    row2.appendChild(actions);

    wrap.appendChild(row1);
    wrap.appendChild(row2);

    chatList.appendChild(wrap);
  });
}

function renderCardsList() {
  if (!sessionUser) {
    cardsList.textContent = "Sign in qiling.";
    return;
  }
  if (!activeChatId) {
    cardsList.textContent = "Chat tanlansa, cardlar ro‘yxati shu yerda ko‘rinadi.";
    return;
  }
  if (activeCards.length === 0) {
    cardsList.textContent = "Bu chatda card yo‘q.";
    return;
  }

  const lines = activeCards.map((c, i) => `${i + 1}. ${c.word} → ${c.translation}`);
  cardsList.textContent = lines.join("\n");
}

function renderFlashcard() {
  if (!sessionUser) {
    activeChatTitle.textContent = "Flashcards";
    activeChatMeta.textContent = "—";
    frontTextEl.textContent = "Sign in qiling.";
    backTextEl.textContent = "—";
    exampleTextEl.textContent = "";
    cardBackEl.classList.add("hidden");
    showAnswer = false;
    return;
  }

  if (!activeChatId) {
    activeChatTitle.textContent = "Flashcards";
    activeChatMeta.textContent = "—";
    frontTextEl.textContent = "Chat tanlang yoki yarating.";
    backTextEl.textContent = "—";
    exampleTextEl.textContent = "";
    cardBackEl.classList.add("hidden");
    showAnswer = false;
    return;
  }

  if (activeCards.length === 0) {
    frontTextEl.textContent = "Chat bo‘sh.";
    backTextEl.textContent = "—";
    exampleTextEl.textContent = "";
    cardBackEl.classList.add("hidden");
    showAnswer = false;
    return;
  }

  const card = activeCards[idx];
  frontTextEl.textContent = card.word;
  backTextEl.textContent = card.translation;
  exampleTextEl.textContent = card.example ? `Example: ${card.example}` : "";

  if (showAnswer) cardBackEl.classList.remove("hidden");
  else cardBackEl.classList.add("hidden");
}

function flip() {
  if (!sessionUser) return;
  if (!activeChatId) return;
  if (activeCards.length === 0) return;
  showAnswer = !showAnswer;
  renderFlashcard();
}

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  sessionUser = data?.session?.user || null;

  setUIAuthed(!!sessionUser);

  extractedWords = [];
  renderWords();
  setOcrStatus("");
  setCreateStatus("");

  activeChatId = null;
  activeCards = [];
  idx = 0;
  showAnswer = false;
  renderCardsList();
  renderFlashcard();

  if (sessionUser) {
    await loadChats();
  } else {
    chats = [];
    renderChats();
  }
}

async function loadChats() {
  const { data, error } = await supabase
    .from("vocab_chats")
    .select("id, title, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    setCreateStatus(`Chats load error: ${error.message}`);
    chats = [];
    renderChats();
    return;
  }

  chats = data || [];
  renderChats();

  if (chats.length > 0) {
    await openChat(chats[0].id);
  }
}

async function openChat(chatId) {
  activeChatId = chatId;
  idx = 0;
  showAnswer = false;

  const chat = chats.find((c) => c.id === chatId);
  activeChatTitle.textContent = chat ? chat.title : "Flashcards";
  activeChatMeta.textContent = chat ? "custom" : "—";

  const { data, error } = await supabase
    .from("vocab_chat_cards")
    .select("id, word, translation, example, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (error) {
    setCreateStatus(`Cards load error: ${error.message}`);
    activeCards = [];
  } else {
    activeCards = (data || []).map((r) => ({
      id: r.id,
      word: r.word,
      translation: r.translation,
      example: r.example || "",
      created_at: r.created_at,
    }));
  }

  renderCardsList();
  renderFlashcard();
}

async function deleteChat(chatId) {
  const { error } = await supabase
    .from("vocab_chats")
    .delete()
    .eq("id", chatId);

  if (error) {
    setCreateStatus(`Delete error: ${error.message}`);
    return;
  }

  await loadChats();
}

/* =========================
   OCR FIX: resize + correct worker init
   ========================= */

function extractWordsFromText(text) {
  const raw = (text || "").toLowerCase();
  const matches = raw.match(/[a-z]+(?:'[a-z]+)?/g) || [];
  const cleaned = matches
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w));

  const set = new Set();
  const out = [];
  for (const w of cleaned) {
    if (!set.has(w)) {
      set.add(w);
      out.push(w);
    }
  }
  return out.slice(0, 120);
}

async function downscaleImageToBlob(file, maxSide = 1400, quality = 0.85) {
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

    if (scale >= 0.98) return file;

    const canvas = document.createElement("canvas");
    canvas.width = nw;
    canvas.height = nh;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, nw, nh);

    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    });

    if (!blob) return file;
    return new File([blob], "ocr.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function runOcrOnFile(file) {
  setOcrStatus("Rasm tayyorlanmoqda...");
  const processed = await downscaleImageToBlob(file);

  setOcrStatus("OCR boshlanmoqda...");

  const worker = await Tesseract.createWorker({
    logger: (m) => {
      if (m?.status && typeof m?.progress === "number") {
        const pct = Math.round(m.progress * 100);
        setOcrStatus(`${m.status}... ${pct}%`);
      } else if (m?.status) {
        setOcrStatus(`${m.status}...`);
      }
    }
  });

  try {
    await worker.load();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");

    await worker.setParameters({
      tessedit_pageseg_mode: "6",
    });

    const { data } = await worker.recognize(processed);
    const text = data?.text || "";

    const words = extractWordsFromText(text);
    extractedWords = words;
    renderWords();

    setOcrStatus(`OCR tugadi. Topildi: ${words.length} ta so‘z.`);
  } catch (e) {
    setOcrStatus(`OCR xato: ${e?.message || "unknown"}`);
  } finally {
    await worker.terminate();
  }
}

/* =========================
   Translate + DB save
   ========================= */

async function translateWordENtoUZ(word) {
  const q = encodeURIComponent(word);
  const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|uz`;

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error("Translate API error");

  const data = await res.json();
  const t = data?.responseData?.translatedText;
  const tr = safeTrim(t);
  return tr || "(tarjima topilmadi)";
}

async function translateWordsBatch(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    setCreateStatus(`Tarjima: ${i + 1}/${words.length} (${w})...`);
    try {
      const tr = await translateWordENtoUZ(w);
      out.push({ word: w, translation: tr });
    } catch {
      out.push({ word: w, translation: "(tarjima xato)" });
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

async function createChatWithCards(title, wordPairs) {
  const { data: chatData, error: chatErr } = await supabase
    .from("vocab_chats")
    .insert({ user_id: sessionUser.id, title })
    .select("id, title, created_at")
    .single();

  if (chatErr) throw chatErr;

  const chatId = chatData.id;

  const rows = wordPairs.map((p) => ({
    chat_id: chatId,
    user_id: sessionUser.id,
    word: p.word,
    translation: p.translation,
    example: null,
  }));

  const { error: cardsErr } = await supabase
    .from("vocab_chat_cards")
    .insert(rows);

  if (cardsErr) throw cardsErr;

  return chatData;
}

/** =========================
 *  Events
 *  ========================= */

signOutBtn.addEventListener("click", async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (e) {
    setCreateStatus(`Sign out error: ${e?.message || "unknown"}`);
  } finally {
    await refreshSession();
  }
});

runOcrBtn.addEventListener("click", async () => {
  if (!sessionUser) { setOcrStatus("Avval Sign in qiling."); return; }
  const file = imageInput.files?.[0];
  if (!file) { setOcrStatus("Iltimos rasm tanlang."); return; }
  await runOcrOnFile(file);
});

clearScanBtn.addEventListener("click", () => {
  imageInput.value = "";
  extractedWords = [];
  renderWords();
  setOcrStatus("");
  setCreateStatus("");
});

addManualWordBtn.addEventListener("click", () => {
  const w = safeTrim(manualWord.value).toLowerCase();
  if (!w) return;
  if (!/^[a-z]+(?:'[a-z]+)?$/.test(w)) {
    setOcrStatus("Faqat inglizcha so‘z kiriting (a-z).");
    return;
  }
  if (!extractedWords.includes(w)) extractedWords.unshift(w);
  manualWord.value = "";
  renderWords();
});

createChatBtn.addEventListener("click", async () => {
  if (!sessionUser) { setCreateStatus("Avval Sign in qiling."); return; }
  if (extractedWords.length === 0) { setCreateStatus("So‘zlar yo‘q. Avval OCR qiling yoki manual qo‘shing."); return; }

  if (chats.length >= 2) {
    setCreateStatus("Limit: 2 ta chat. Avval bittasini o‘chirib, keyin yarating.");
    return;
  }

  const titleRaw = safeTrim(chatTitle.value);
  const title = titleRaw || `Reading chat ${new Date().toLocaleString()}`;

  try {
    setCreateStatus("Tarjima boshlanmoqda (EN→UZ)...");
    const pairs = await translateWordsBatch(extractedWords);

    setCreateStatus("Chat yaratilmoqda...");
    const newChat = await createChatWithCards(title, pairs);

    await loadChats();
    await openChat(newChat.id);

    extractedWords = [];
    renderWords();
    imageInput.value = "";
    chatTitle.value = "";
    setOcrStatus("");
    setCreateStatus("Tayyor ✅");
  } catch (e) {
    setCreateStatus(`Xato: ${e?.message || "unknown"}`);
  }
});

cardEl.addEventListener("click", () => flip());
cardEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
});

prevBtn.addEventListener("click", () => {
  if (!sessionUser || !activeChatId || activeCards.length === 0) return;
  idx = (idx - 1 + activeCards.length) % activeCards.length;
  showAnswer = false;
  renderFlashcard();
});

nextBtn.addEventListener("click", () => {
  if (!sessionUser || !activeChatId || activeCards.length === 0) return;
  idx = (idx + 1) % activeCards.length;
  showAnswer = false;
  renderFlashcard();
});

exportBtn.addEventListener("click", () => {
  if (!sessionUser) { setCreateStatus("Export uchun Sign in qiling."); return; }
  if (!activeChatId) { setCreateStatus("Export uchun chat tanlang."); return; }

  const payload = {
    chat: chats.find((c) => c.id === activeChatId) || null,
    cards: activeCards,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "vocab_chat_export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

importBtn.addEventListener("click", () => {
  if (!sessionUser) { setCreateStatus("Import uchun Sign in qiling."); return; }
  importFile.click();
});

importFile.addEventListener("change", async () => {
  if (!sessionUser) return;
  const file = importFile.files?.[0];
  if (!file) return;

  if (chats.length >= 2) {
    setCreateStatus("Limit: 2 ta chat. Import qilish uchun bittasini o‘chiring.");
    importFile.value = "";
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    const title = safeTrim(parsed?.chat?.title) || `Imported chat ${new Date().toLocaleString()}`;
    const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];

    const pairs = cards
      .filter((c) => c && typeof c.word === "string" && typeof c.translation === "string")
      .map((c) => ({ word: safeTrim(c.word).toLowerCase(), translation: safeTrim(c.translation) }))
      .filter((c) => c.word && c.translation);

    if (pairs.length === 0) { setCreateStatus("Import xato: cards topilmadi."); return; }

    setCreateStatus("Import: chat yaratilmoqda...");
    const newChat = await createChatWithCards(title, pairs);

    await loadChats();
    await openChat(newChat.id);

    setCreateStatus("Import tugadi ✅");
  } catch (e) {
    setCreateStatus(`Import xato: ${e?.message || "unknown"}`);
  } finally {
    importFile.value = "";
  }
});

/** =========================
 *  Init
 *  ========================= */
(async function init() {
  // show clear config error early
  if (!SUPABASE_URL.startsWith("https://") || !SUPABASE_ANON_KEY) {
    setOcrStatus("Supabase config noto‘g‘ri. config.js ni tekshiring.");
  }

  extractedWords = [];
  renderWords();
  renderChats();
  renderCardsList();
  renderFlashcard();

  supabase.auth.onAuthStateChange(async () => {
    await refreshSession();
  });

  await refreshSession();
})();
