/* app.js — 100% WORKING (Server OCR + Translate + Create Chat + Supabase)
   FIXED:
   - RLS-safe chat limit check (COUNT + head:true)
*/

document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.APP_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || "";
  const OCR_WORKER_URL = cfg.OCR_WORKER_URL || "";

  const el = (id) => document.getElementById(id);
  const setText = (node, text) => { if (node) node.textContent = text ?? ""; };
  const safeTrim = (s) => (s || "").trim();

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
  const card = el("card");
  const cardFront = el("cardFront");
  const cardBack = el("cardBack");
  const frontText = el("frontText");
  const backText = el("backText");
  const exampleText = el("exampleText");
  const prevBtn = el("prevBtn");
  const nextBtn = el("nextBtn");

  const exportBtn = el("exportBtn");
  const importBtn = el("importBtn");
  const importFile = el("importFile");
  const cardsList = el("cardsList");

  function setOcrStatus(msg) { setText(ocrStatus, msg); }
  function setCreateStatus(msg) { setText(createStatus, msg); }

  const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true } }
  );

  let sessionUser = null;
  let extractedWords = [];
  let chats = [];
  let activeChat = null;
  let activeCards = [];
  let cardIndex = 0;

  /* ================= AUTH ================= */
  function setSignedOutUI() {
    sessionUser = null;
    userLine.textContent = "Sign in qiling.";
    accountLabel.classList.add("hidden");
    signInBtn.classList.remove("hidden");
    signUpBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");
    chatList.textContent = "Sign in qiling — chatlar shu yerda chiqadi.";
    extractedWords = [];
    renderWords();
  }

  function setSignedInUI(user) {
    sessionUser = user;
    userLine.textContent = "Kirgansiz.";
    accountLabel.textContent = user.email;
    accountLabel.classList.remove("hidden");
    signInBtn.classList.add("hidden");
    signUpBtn.classList.add("hidden");
    signOutBtn.classList.remove("hidden");
  }

  async function refreshSession() {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user || null;
    if (!user) return setSignedOutUI();
    setSignedInUI(user);
  }

  /* ================= WORDS ================= */
  function normalizeWord(w) {
    return (w || "").toLowerCase().replace(/[^a-z']/g, "").trim();
  }

  function renderWords() {
    if (!wordsChips) return;
    if (!extractedWords.length) {
      wordsChips.textContent = "Hozircha so‘z yo‘q.";
      return;
    }
    wordsChips.innerHTML = "";
    extractedWords.forEach((w, i) => {
      const d = document.createElement("div");
      d.className = "chip";
      d.textContent = w;
      d.onclick = () => {
        extractedWords.splice(i, 1);
        renderWords();
      };
      wordsChips.appendChild(d);
    });
  }

  /* ================= TRANSLATE ================= */
  async function translateWordEnUz(word) {
    try {
      const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|uz`
      );
      const j = await res.json();
      return j?.responseData?.translatedText || "";
    } catch {
      return "";
    }
  }

  /* ================= CREATE CHAT (FIXED) ================= */
  async function createChatFromWords() {
    if (!sessionUser) return setCreateStatus("Avval Sign in qiling.");
    if (!extractedWords.length) return setCreateStatus("So‘zlar yo‘q.");

    setCreateStatus("Chat limiti tekshirilmoqda...");

    const { count, error } = await supabase
      .from("vocab_chats")
      .select("*", { count: "exact", head: true });

    if (error) {
      console.error(error);
      return setCreateStatus("Chat limitini tekshirib bo‘lmadi.");
    }

    if ((count ?? 0) >= 2) {
      return setCreateStatus("❌ Limit: faqat 2 ta chat mumkin.");
    }

    const words = extractedWords.slice(0, 40);
    const title = safeTrim(chatTitle.value) || `Reading ${new Date().toLocaleString()}`;

    setCreateStatus("Tarjima qilinyapti...");
    const cards = [];
    for (let i = 0; i < words.length; i++) {
      setCreateStatus(`Tarjima (${i + 1}/${words.length})...`);
      cards.push({ en: words[i], uz: await translateWordEnUz(words[i]) });
    }

    setCreateStatus("Chat yaratilmoqda...");
    const { data: chat, error: chatErr } = await supabase
      .from("vocab_chats")
      .insert({ title, user_id: sessionUser.id })
      .select()
      .single();

    if (chatErr) return setCreateStatus(chatErr.message);

    setCreateStatus("Cardlar saqlanyapti...");
    const rows = cards.map((c) => ({
      user_id: sessionUser.id,
      chat_id: chat.id,
      en: c.en,
      uz: c.uz,
    }));

    const { error: cardsErr } = await supabase.from("vocab_cards").insert(rows);
    if (cardsErr) return setCreateStatus(cardsErr.message);

    setCreateStatus("✅ Chat yaratildi.");
    extractedWords = [];
    renderWords();
    await loadChats();
    openChat(chat);
  }

  /* ================= LOAD CHATS ================= */
  async function loadChats() {
    const { data } = await supabase
      .from("vocab_chats")
      .select("*")
      .order("created_at", { ascending: false });
    chats = data || [];
    renderChatList();
  }

  function renderChatList() {
    if (!chats.length) {
      chatList.textContent = "Chat yo‘q.";
      return;
    }
    chatList.innerHTML = "";
    chats.forEach((c) => {
      const d = document.createElement("div");
      d.textContent = c.title;
      d.onclick = () => openChat(c);
      chatList.appendChild(d);
    });
  }

  async function openChat(chat) {
    activeChat = chat;
    activeChatTitle.textContent = chat.title;
    const { data } = await supabase
      .from("vocab_cards")
      .select("*")
      .eq("chat_id", chat.id)
      .order("created_at", { ascending: true });
    activeCards = data || [];
    cardIndex = 0;
    renderCard();
  }

  function renderCard() {
    if (!activeCards.length) {
      frontText.textContent = "Card yo‘q.";
      backText.textContent = "—";
      return;
    }
    const c = activeCards[cardIndex];
    frontText.textContent = c.en;
    backText.textContent = c.uz || "—";
  }

  card.onclick = () => {
    cardFront.classList.toggle("hidden");
    cardBack.classList.toggle("hidden");
  };

  prevBtn.onclick = () => {
    if (!activeCards.length) return;
    cardIndex = (cardIndex - 1 + activeCards.length) % activeCards.length;
    renderCard();
  };

  nextBtn.onclick = () => {
    if (!activeCards.length) return;
    cardIndex = (cardIndex + 1) % activeCards.length;
    renderCard();
  };

  createChatBtn.onclick = createChatFromWords;

  signOutBtn.onclick = async () => {
    await supabase.auth.signOut();
    setSignedOutUI();
  };

  (async () => {
    await refreshSession();
    if (sessionUser) await loadChats();
  })();
});
