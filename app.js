/* ===========
  app.js (A-variant)
  - Index sahifada auth linklar (auth.html) bor, modal yo‘q
  - Session bo‘lsa userLine’da email ko‘rsatadi
  - Custom cards Supabase DB’da saqlanadi va faqat egasi ko‘radi (RLS)
=========== */

const SUPABASE_URL = "PASTE_YOUR_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ===== Seed decks ===== */
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

const el = (id) => document.getElementById(id);

const userLine = el("userLine");
const signInBtn = el("signInBtn");   // <a>
const signUpBtn = el("signUpBtn");   // <a>
const signOutBtn = el("signOutBtn"); // <button>

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

let sessionUser = null;

let showAnswer = false;
let currentDeck = "beginner";
let currentMode = "front";
let cards = [];
let idx = 0;

let customCards = [];

const CACHE_KEY = "vocab_cards_custom_cache_v1";

function safeTrim(s) { return (s || "").trim(); }
function normalizeWord(w) { return safeTrim(w).toLowerCase(); }

function setStatus(msg) {
  statusEl.className = "status muted";
  statusEl.textContent = msg;
}

function setUIAuthed(isAuthed) {
  if (isAuthed) {
    signOutBtn.classList.remove("hidden");
    signInBtn.classList.add("hidden");
    signUpBtn.classList.add("hidden");
    addForm.querySelectorAll("input,select,button").forEach((x) => (x.disabled = false));
  } else {
    signOutBtn.classList.add("hidden");
    signInBtn.classList.remove("hidden");
    signUpBtn.classList.remove("hidden");
    addForm.querySelectorAll("input,select,button").forEach((x) => (x.disabled = true));
  }
}

function cacheSet(list) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch {}
}
function cacheGet() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function cacheClear() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

/* ===== Deck logic ===== */
function getAllSeed() {
  return [
    ...seedDecks.beginner,
    ...seedDecks.intermediate,
    ...seedDecks.advanced,
    ...seedDecks.ielts,
  ];
}

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

/* ===== Supabase DB ops (custom cards) ===== */
async function dbLoadCustomCards() {
  if (!sessionUser) return;

  // cache first
  const cached = cacheGet();
  if (cached.length > 0) {
    customCards = cached;
    renderCustomList();
    setDeck(deckSelect.value);
  }

  const { data, error } = await supabase
    .from("vocab_cards")
    .select("id, word, meaning, example, tag, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(`DB o‘qishda xato: ${error.message}`);
    return;
  }

  customCards = (data || []).map((r) => ({
    id: r.id,
    word: r.word,
    meaning: r.meaning,
    example: r.example || "",
    tag: r.tag || "custom",
    created_at: r.created_at,
  }));

  cacheSet(customCards);
  renderCustomList();
  setDeck(deckSelect.value);
}

async function dbInsertCard(card) {
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

/* ===== Auth state ===== */
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

async function doSignOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/* ===== Events ===== */
signOutBtn.addEventListener("click", async () => {
  try {
    await doSignOut();
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

cardEl.addEventListener("click", flip);
cardEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    flip();
  }
});

// Add card (DB)
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

  // duplikat (client)
  const wn = normalizeWord(rawWord);
  if (customCards.some((c) => normalizeWord(c.word) === wn)) {
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
    if (current === "custom" || current === "all") setDeck(current);
  } catch (err) {
    setStatus(`Saqlash xato: ${err?.message || "unknown error"}`);
  }
});

// Export
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

// Import
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

    const cleaned = parsed
      .filter((c) => c && typeof c.word === "string" && typeof c.meaning === "string")
      .map((c) => ({
        word: safeTrim(c.word),
        meaning: safeTrim(c.meaning),
        example: safeTrim(c.example),
        tag: safeTrim(c.tag) || "custom",
      }))
      .filter((c) => c.word && c.meaning);

    let added = 0;

    for (const c of cleaned) {
      const wn = normalizeWord(c.word);
      if (customCards.some((x) => normalizeWord(x.word) === wn)) continue;

      try {
        const inserted = await dbInsertCard(c);
        customCards.unshift(inserted);
        added++;
      } catch {
        // skip xato row
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

// Reset = local cache only
resetBtn.addEventListener("click", () => {
  cacheClear();
  setStatus("Local cache tozalandi. (DB saqlanib qoladi)");
});

/* ===== Init ===== */
(async function init() {
  // Login bo‘lmaguncha addForm disable
  setUIAuthed(false);
  renderCustomList();

  currentDeck = deckSelect.value;
  currentMode = modeSelect.value;
  setDeck(currentDeck);

  supabase.auth.onAuthStateChange(async () => {
    await refreshSession();
  });

  await refreshSession();
})();
