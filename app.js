/* ===========
  Vocab Cards (Auth + Free DB via Supabase)
  - Seed decks (levels)
  - Custom cards saved per-user in Supabase (public.vocab_cards)
  - Static site compatible (GitHub Pages)
  - Flip: clicking the card
=========== */

/** =========================
 *  0) Supabase config
 *  ========================= */
const SUPABASE_URL = "PASTE_YOUR_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

// Supabase JS is loaded from CDN in index.html
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // :contentReference[oaicite:2]{index=2}

/** =========================
 *  1) Seed decks (tarjimasiz)
 *  ========================= */
const seedDecks = {
  beginner: [
    { word: "family", meaning: "oila", example: "My family is very supportive.", tag: "beginner" },
    { word: "important", meaning: "muhim", example: "It is important to sleep well.", tag: "beginner" },
    { word: "increase", meaning: "oshirmoq", example: "We need to increase productivity.", tag: "beginner" },
  ],
  intermediate: [
    { word: "however", meaning: "biroq", example: "However, the results were different.", tag: "intermediate" },
    { word: "benefit", meaning: "foyda", example: "Exercise brings many benefits.", tag: "intermediate" },
    { word: "require", meaning: "talab qilmoq", example: "This job requires experience.", tag: "intermediate" },
  ],
  advanced: [
    { word: "substantial", meaning: "sezilarli", example: "There was a substantial increase in sales.", tag: "advanced" },
    { word: "mitigate", meaning: "yumshatmoq (salbiy ta’sirni)", example: "Policies can mitigate risk.", tag: "advanced" },
    { word: "intricate", meaning: "murakkab", example: "The design is intricate and detailed.", tag: "advanced" },
  ],
  ielts: [
    { word: "allocate", meaning: "ajratmoq (resurs/budjet)", example: "The government allocated funds to education.", tag: "ielts" },
    { word: "decline", meaning: "pasayish / rad etish", example: "The number of visitors declined.", tag: "ielts" },
    { word: "significant", meaning: "ahamiyatli", example: "There was a significant change.", tag: "ielts" },
  ],
};

/** =========================
 *  2) DOM helpers
 *  ========================= */
const el = (id) => document.getElementById(id);

const userLine = el("userLine");

const signInBtn = el("signInBtn");
const signUpBtn = el("signUpBtn");
const signOutBtn = el("signOutBtn");

const authModal = el("authModal");
const authBackdrop = el("authBackdrop");
const authClose = el("authClose");
const authTitle = el("authTitle");
const authForm = el("authForm");
const authEmail = el("authEmail");
const authPassword = el("authPassword");
const authStatus = el("authStatus");
const authSubmit = el("authSubmit");

const addForm = el("addForm");
const wordInput = el("wordInput");
const meaningInput = el("meaningInput");
const exampleInput = el("exampleInput");
const levelSelect = el("levelSelect");
const statusEl = el("status");

const deckSelect = el("deckSelect");
const modeSelect = el("modeSelect");
const shuffleBtn = el("shuffleBtn");
const toggleAnswerBtn = el("toggleAnswerBtn");

const totalCountEl = el("totalCount");
const deckCountEl = el("deckCount");

const cardEl = el("card");
const cardTagEl = el("cardTag");
const frontTextEl = el("frontText");
const backTextEl = el("backText");
const exampleTextEl = el("exampleText");
const cardBackEl = el("cardBack");

const prevBtn = el("prevBtn");
const nextBtn = el("nextBtn");

const customListEl = el("customList");
const exportBtn = el("exportBtn");
const importBtn = el("importBtn");
const importFile = el("importFile");
const resetBtn = el("resetBtn");

/** =========================
 *  3) App state
 *  ========================= */
let sessionUser = null;

let showAnswer = false;
let currentDeck = "beginner";
let currentMode = "front";
let cards = [];
let idx = 0;

// Cache (optional): local cache for faster UI (not source of truth)
const CACHE_KEY = "vocab_cards_custom_cache_v1";

/** =========================
 *  4) Utilities
 *  ========================= */
function safeTrim(s) {
  return (s || "").trim();
}
function normalizeWord(w) {
  return safeTrim(w).toLowerCase();
}
function setStatus(msg) {
  statusEl.className = "status muted";
  statusEl.textContent = msg;
}
function setAuthStatus(msg) {
  authStatus.className = "status muted";
  authStatus.textContent = msg;
}
function openAuthModal(mode /* 'in' | 'up' */) {
  authModal.classList.remove("hidden");
  authModal.setAttribute("aria-hidden", "false");
  authEmail.value = "";
  authPassword.value = "";
  setAuthStatus("");
  if (mode === "up") {
    authTitle.textContent = "Sign up";
    authSubmit.textContent = "Create account";
    authForm.dataset.mode = "up";
  } else {
    authTitle.textContent = "Sign in";
    authSubmit.textContent = "Sign in";
    authForm.dataset.mode = "in";
  }
  authEmail.focus();
}
function closeAuthModal() {
  authModal.classList.add("hidden");
  authModal.setAttribute("aria-hidden", "true");
}

function setUIAuthed(isAuthed) {
  if (isAuthed) {
    signInBtn.classList.add("hidden");
    signUpBtn.classList.add("hidden");
    signOutBtn.classList.remove("hidden");
    addForm.querySelectorAll("input,select,button").forEach((x) => (x.disabled = false));
  } else {
    signInBtn.classList.remove("hidden");
    signUpBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");
    addForm.querySelectorAll("input,select,button").forEach((x) => (x.disabled = true));
  }
}

function cacheSet(list) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {}
}
function cacheGet() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function cacheClear() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
}

/** =========================
 *  5) Deck building
 *  ========================= */
function getAllSeed() {
  return [
    ...seedDecks.beginner,
    ...seedDecks.intermediate,
    ...seedDecks.advanced,
    ...seedDecks.ielts,
  ];
}

let customCards = []; // loaded from DB per user

function buildDeck(deckKey) {
  const allSeed = getAllSeed();
  if (deckKey === "custom") return [...customCards];
  if (deckKey === "all") return [...allSeed, ...customCards];
  if (seedDecks[deckKey]) return [...seedDecks[deckKey]];
  return [];
}

function updateStats() {
  const allSeed = getAllSeed();
  totalCountEl.textContent = String(allSeed.length + customCards.length);
  deckCountEl.textContent = String(cards.length);
}

function renderCustomList() {
  if (!sessionUser) {
    customListEl.textContent = "Sign in qiling — custom kartalar shu yerda ko‘rinadi.";
    return;
  }
  if (customCards.length === 0) {
    customListEl.textContent = "Hozircha custom so‘z yo‘q.";
    return;
  }

  const lines = customCards.map((c, i) => {
    const ex = c.example ? ` | ex: ${c.example}` : "";
    return `${i + 1}. ${c.word} → ${c.meaning} (${c.tag})${ex}`;
  });
  customListEl.textContent = lines.join("\n");
}

function pickFrontBack(card) {
  const mode = currentMode;
  const rand = Math.random() < 0.5;

  let front = card.word;
  let back = card.meaning || "—";

  if (mode === "back") {
    front = card.meaning || "—";
    back = card.word;
  } else if (mode === "mixed") {
    if (rand) {
      front = card.word;
      back = card.meaning || "—";
    } else {
      front = card.meaning || "—";
      back = card.word;
    }
  }
  return { front, back };
}

function renderCard() {
  if (cards.length === 0) {
    cardTagEl.textContent = "—";
    frontTextEl.textContent = "Deck tanlang yoki lug‘at qo‘shing.";
    backTextEl.textContent = "—";
    exampleTextEl.textContent = "";
    cardBackEl.classList.add("hidden");
    showAnswer = false;
    updateStats();
    return;
  }

  const card = cards[idx];
  const { front, back } = pickFrontBack(card);

  cardTagEl.textContent = card.tag || currentDeck;
  frontTextEl.textContent = front;
  backTextEl.textContent = back;

  const ex = safeTrim(card.example);
  exampleTextEl.textContent = ex ? `Example: ${ex}` : "";

  if (showAnswer) cardBackEl.classList.remove("hidden");
  else cardBackEl.classList.add("hidden");

  updateStats();
}

function setDeck(deckKey) {
  currentDeck = deckKey;
  cards = buildDeck(deckKey);
  idx = 0;
  showAnswer = false;
  renderCard();
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function flip() {
  if (cards.length === 0) return;
  showAnswer = !showAnswer;
  renderCard();
}

/** =========================
 *  6) Supabase DB operations
 *  ========================= */
async function dbLoadCustomCards() {
  if (!sessionUser) return [];

  // Fast path: show cache immediately
  const cached = cacheGet();
  if (cached.length > 0) {
    customCards = cached;
    renderCustomList();
    setDeck(deckSelect.value);
  }

  // Source of truth: DB
  const { data, error } = await supabase
    .from("vocab_cards")
    .select("id, word, meaning, example, tag, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(`DB o‘qishda xato: ${error.message}`);
    return customCards;
  }

  const mapped = (data || []).map((r) => ({
    id: r.id,
    word: r.word,
    meaning: r.meaning,
    example: r.example || "",
    tag: r.tag || "custom",
    created_at: r.created_at,
  }));

  customCards = mapped;
  cacheSet(customCards);
  renderCustomList();
  setDeck(deckSelect.value);

  return customCards;
}

async function dbInsertCard(card) {
  // RLS policy sabab user_id’ni client’dan berish shart emas, lekin biz insertda user_id’ni aniq beramiz.
  // (Auth uid bilan match bo‘lmasa insert baribir o‘tmaydi.)
  const payload = {
    user_id: sessionUser.id,
    word: card.word,
    meaning: card.meaning,
    example: card.example || null,
    tag: card.tag || "custom",
  };

  const { data, error } = await supabase
    .from("vocab_cards")
    .insert(payload)
    .select("id, word, meaning, example, tag, created_at")
    .single();

  if (error) throw error;

  return {
    id: data.id,
    word: data.word,
    meaning: data.meaning,
    example: data.example || "",
    tag: data.tag || "custom",
    created_at: data.created_at,
  };
}

/** =========================
 *  7) Auth flows
 *  ========================= */
async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  sessionUser = data?.session?.user || null;

  if (sessionUser) {
    userLine.textContent = `Signed in: ${sessionUser.email}`;
    setUIAuthed(true);
    await dbLoadCustomCards();
  } else {
    userLine.textContent = "Sign in qiling.";
    setUIAuthed(false);
    customCards = [];
    cacheClear();
    renderCustomList();
    setDeck(deckSelect.value);
  }
}

// Sign in / up via email+password (Supabase docs)
async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password }); // :contentReference[oaicite:3]{index=3}
  if (error) throw error;
}
async function signUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}
async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** =========================
 *  8) Event listeners
 *  ========================= */
signInBtn.addEventListener("click", () => openAuthModal("in"));
signUpBtn.addEventListener("click", () => openAuthModal("up"));
authClose.addEventListener("click", closeAuthModal);
authBackdrop.addEventListener("click", closeAuthModal);

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = safeTrim(authEmail.value);
  const password = safeTrim(authPassword.value);
  if (!email || !password) return;

  setAuthStatus("Processing...");

  try {
    const mode = authForm.dataset.mode || "in";
    if (mode === "up") {
      await signUp(email, password);
      setAuthStatus("Account created. Agar email confirmation yoqilgan bo‘lsa, emailingizni tasdiqlang.");
    } else {
      await signIn(email, password);
      setAuthStatus("Signed in ✅");
      closeAuthModal();
    }

    await refreshSession();
  } catch (err) {
    setAuthStatus(`Xato: ${err?.message || "unknown error"}`);
  }
});

signOutBtn.addEventListener("click", async () => {
  try {
    await signOut();
  } catch (err) {
    setStatus(`Sign out xato: ${err?.message || "unknown error"}`);
  } finally {
    await refreshSession();
  }
});

deckSelect.addEventListener("change", () => setDeck(deckSelect.value));

modeSelect.addEventListener("change", () => {
  currentMode = modeSelect.value;
  renderCard();
});

shuffleBtn.addEventListener("click", () => {
  if (cards.length === 0) return;
  cards = shuffle(cards);
  idx = 0;
  showAnswer = false;
  renderCard();
});

toggleAnswerBtn.addEventListener("click", () => {
  showAnswer = !showAnswer;
  renderCard();
});

prevBtn.addEventListener("click", () => {
  if (cards.length === 0) return;
  idx = (idx - 1 + cards.length) % cards.length;
  showAnswer = false;
  renderCard();
});

nextBtn.addEventListener("click", () => {
  if (cards.length === 0) return;
  idx = (idx + 1) % cards.length;
  showAnswer = false;
  renderCard();
});

cardEl.addEventListener("click", () => flip());
cardEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    flip();
  }
});

// Add card: endi DB ga yoziladi (faqat sign in bo‘lsa)
addForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!sessionUser) {
    setStatus("Avval Sign in qiling.");
    return;
  }

  const rawWord = safeTrim(wordInput.value);
  const meaning = safeTrim(meaningInput.value);
  const tag = levelSelect.value === "custom" ? "custom" : levelSelect.value;
  const example = safeTrim(exampleInput.value);

  if (!rawWord || !meaning) return;

  // Client-side duplicate check (customCards)
  const wn = normalizeWord(rawWord);
  const dup = customCards.some((c) => normalizeWord(c.word) === wn);
  if (dup) {
    setStatus("Bu so‘z custom ro‘yxatda bor. (Duplikat qo‘shilmadi)");
    return;
  }

  setStatus("Saqlanyapti...");

  try {
    const inserted = await dbInsertCard({ word: rawWord, meaning, example, tag });
    customCards.unshift(inserted);
    cacheSet(customCards);

    setStatus("Qo‘shildi ✅");
    wordInput.value = "";
    meaningInput.value = "";
    exampleInput.value = "";

    renderCustomList();

    const current = deckSelect.value;
    if (current === "custom" || current === "all") {
      setDeck(current);
    }
  } catch (err) {
    setStatus(`Saqlash xato: ${err?.message || "unknown error"}`);
  }
});

// Export/Import: endi customCards bilan ishlaydi (DB sinxron)
exportBtn.addEventListener("click", () => {
  if (!sessionUser) {
    setStatus("Export uchun Sign in qiling.");
    return;
  }
  const blob = new Blob([JSON.stringify(customCards, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "vocab_custom_export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

importBtn.addEventListener("click", () => {
  if (!sessionUser) {
    setStatus("Import uchun Sign in qiling.");
    return;
  }
  importFile.click();
});

importFile.addEventListener("change", async () => {
  if (!sessionUser) return;

  const file = importFile.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed)) {
      setStatus("Import xato: JSON array bo‘lishi kerak.");
      return;
    }

    // Clean
    const cleaned = parsed
      .filter((c) => c && typeof c.word === "string" && typeof c.meaning === "string")
      .map((c) => ({
        word: safeTrim(c.word),
        meaning: safeTrim(c.meaning),
        example: safeTrim(c.example),
        tag: safeTrim(c.tag) || "custom",
      }))
      .filter((c) => c.word && c.meaning);

    // Insert one-by-one (simple MVP). Keyin batch qilamiz.
    let added = 0;
    for (const c of cleaned) {
      const wn = normalizeWord(c.word);
      const exists = customCards.some((x) => normalizeWord(x.word) === wn);
      if (exists) continue;

      try {
        const inserted = await dbInsertCard(c);
        customCards.unshift(inserted);
        added++;
      } catch {
        // skip problematic rows
      }
    }

    cacheSet(customCards);
    renderCustomList();

    const current = deckSelect.value;
    if (current === "custom" || current === "all") setDeck(current);

    setStatus(`Import tugadi ✅ Yangi qo‘shildi: ${added} ta`);
  } catch {
    setStatus("Import xato: JSON o‘qilmadi.");
  } finally {
    importFile.value = "";
  }
});

// Reset: faqat local cache (DB o‘chmaydi!)
resetBtn.addEventListener("click", () => {
  cacheClear();
  setStatus("Local cache tozalandi. (DB saqlanib qoladi)");
});

/** =========================
 *  9) Init
 *  ========================= */
(async function init() {
  // Disable add form until auth
  setUIAuthed(false);
  renderCustomList();

  currentDeck = deckSelect.value;
  currentMode = modeSelect.value;
  setDeck(currentDeck);

  // Listen auth state changes
  supabase.auth.onAuthStateChange(async () => {
    await refreshSession();
  });

  await refreshSession();
})();
