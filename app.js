/* =========================
   CONFIG
========================= */
const cfg = window.APP_CONFIG;

/* =========================
   SUPABASE INIT
========================= */
const supabase = window.supabase.createClient(
  cfg.SUPABASE_URL,
  cfg.SUPABASE_ANON_KEY
);

/* =========================
   STATE
========================= */
let sessionUser = null;
let chats = [];
let activeChat = null;
let extractedWords = [];

/* =========================
   ELEMENTS
========================= */
const userLine = document.getElementById("userLine");
const signOutBtn = document.getElementById("signOutBtn");

const createStatusEl = document.getElementById("createStatus");
const chatTitle = document.getElementById("chatTitle");

const wordsList = document.getElementById("wordsList");
const chatsList = document.getElementById("chatsList");
const cardsList = document.getElementById("cardsList");

/* =========================
   HELPERS
========================= */
function setCreateStatus(txt) {
  if (createStatusEl) createStatusEl.textContent = txt || "";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])
  );
}

/* =========================
   AUTH
========================= */
async function initAuth() {
  const { data } = await supabase.auth.getSession();
  sessionUser = data.session?.user || null;
  updateAuthUI();

  supabase.auth.onAuthStateChange((_e, session) => {
    sessionUser = session?.user || null;
    updateAuthUI();
    if (sessionUser) loadChats();
  });
}

function updateAuthUI() {
  if (sessionUser) {
    userLine.textContent = sessionUser.email;
    signOutBtn.classList.remove("hidden");
  } else {
    userLine.textContent = "Sign in qiling.";
    signOutBtn.classList.add("hidden");
    chatsList.innerHTML = "Sign in qiling — chatlar shu yerda chiqadi.";
    cardsList.innerHTML = "";
  }
}

signOutBtn?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.reload();
});

/* =========================
   OCR WORDS (already extracted)
========================= */
function renderWords() {
  if (!wordsList) return;

  if (!extractedWords.length) {
    wordsList.textContent = "Hozircha so‘z yo‘q.";
    return;
  }

  wordsList.innerHTML = "";
  extractedWords.forEach((w, i) => {
    const el = document.createElement("div");
    el.textContent = w;
    el.onclick = () => {
      extractedWords.splice(i, 1);
      renderWords();
    };
    wordsList.appendChild(el);
  });
}

/* =========================
   CREATE CHAT (FIXED)
========================= */
async function createChatFromWords() {
  if (!sessionUser) {
    setCreateStatus("Avval Sign in qiling.");
    return;
  }

  if (!extractedWords.length) {
    setCreateStatus("Avval OCR qiling yoki so‘z qo‘shing.");
    return;
  }

  /* ✅ FIXED CHAT LIMIT CHECK (RLS SAFE) */
  setCreateStatus("Chat limiti tekshirilmoqda...");

  const { count, error } = await supabase
    .from("vocab_chats")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error(error);
    setCreateStatus("Chat limitini tekshirib bo‘lmadi.");
    return;
  }

  if ((count ?? 0) >= 2) {
    setCreateStatus("❌ Limit: faqat 2 ta chat mumkin. Avval bittasini o‘chiring.");
    return;
  }

  /* LIMIT WORDS (FAST) */
  const MAX_WORDS = 99;
  const words = extractedWords.slice(0, MAX_WORDS);

  /* TRANSLATE */
  setCreateStatus("Tarjima qilinyapti...");

  async function translate(word) {
    try {
      const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
          word
        )}&langpair=en|uz`
      );
      const j = await res.json();
      return j?.responseData?.translatedText || "";
    } catch {
      return "";
    }
  }

  const cards = [];
  for (let i = 0; i < words.length; i++) {
    setCreateStatus(`Tarjima (${i + 1}/${words.length})...`);
    cards.push({
      en: words[i],
      uz: await translate(words[i]),
    });
  }

  /* CREATE CHAT */
  setCreateStatus("Chat yaratilmoqda...");
  const title =
    chatTitle?.value?.trim() || `Reading ${new Date().toLocaleString()}`;

  const { data: chat, error: chatErr } = await supabase
    .from("vocab_chats")
    .insert({ title, user_id: sessionUser.id })
    .select()
    .single();

  if (chatErr) {
    console.error(chatErr);
    setCreateStatus("Chat yaratishda xato.");
    return;
  }

  /* INSERT CARDS */
  setCreateStatus("Cardlar saqlanyapti...");
  const rows = cards.map((c) => ({
    user_id: sessionUser.id,
    chat_id: chat.id,
    en: c.en,
    uz: c.uz,
  }));

  const { error: cardsErr } = await supabase
    .from("vocab_cards")
    .insert(rows);

  if (cardsErr) {
    console.error(cardsErr);
    setCreateStatus("Cardlarni saqlashda xato.");
    return;
  }

  /* DONE */
  setCreateStatus("✅ Tayyor. Chat yaratildi.");
  extractedWords = [];
  renderWords();
  chatTitle.value = "";

  await loadChats();
  openChat(chat);
}

/* =========================
   LOAD CHATS
========================= */
async function loadChats() {
  const { data, error } = await supabase
    .from("vocab_chats")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return;

  chats = data || [];
  renderChats();
}

function renderChats() {
  if (!chats.length) {
    chatsList.textContent = "Hozircha chat yo‘q.";
    return;
  }

  chatsList.innerHTML = "";
  chats.forEach((c) => {
    const el = document.createElement("div");
    el.textContent = c.title;
    el.onclick = () => openChat(c);
    chatsList.appendChild(el);
  });
}

/* =========================
   OPEN CHAT
========================= */
async function openChat(chat) {
  activeChat = chat;

  const { data, error } = await supabase
    .from("vocab_cards")
    .select("*")
    .eq("chat_id", chat.id);

  if (error) return;

  cardsList.innerHTML = "";
  data.forEach((c) => {
    const el = document.createElement("div");
    el.innerHTML = `<b>${escapeHtml(c.en)}</b> — ${escapeHtml(c.uz || "")}`;
    cardsList.appendChild(el);
  });
}

/* =========================
   INIT
========================= */
initAuth();

/* expose for button */
window.createChatFromWords = createChatFromWords;
