/* ===========
  auth.js (A-variant, robust)
  - UI tab switch ALWAYS works (even if Supabase config is wrong)
  - Sign up/in works when SUPABASE_URL + SUPABASE_ANON_KEY are correct
  - Redirect after login -> index.html on same host
=========== */

document.addEventListener("DOMContentLoaded", () => {
  const el = (id) => document.getElementById(id);

  const authTopLine = el("authTopLine");
  const hintLine = el("hintLine");

  const tabSignUp = el("tabSignUp");
  const tabSignIn = el("tabSignIn");

  const signUpForm = el("signUpForm");
  const signUpEmail = el("signUpEmail");
  const signUpPassword = el("signUpPassword");
  const signUpStatus = el("signUpStatus");

  const signInForm = el("signInForm");
  const signInEmail = el("signInEmail");
  const signInPassword = el("signInPassword");
  const signInStatus = el("signInStatus");

  function safeTrim(s) { return (s || "").trim(); }
  function setStatus(node, msg) { node.className = "status muted"; node.textContent = msg || ""; }

  function goHome() {
    window.location.href = `${window.location.origin}/index.html`;
  }

  function setMode(mode /* 'up' | 'in' */) {
    setStatus(signUpStatus, "");
    setStatus(signInStatus, "");

    if (mode === "in") {
      tabSignIn.classList.add("active");
      tabSignUp.classList.remove("active");
      signInForm.classList.remove("hidden");
      signUpForm.classList.add("hidden");
      authTopLine.textContent = "Kirish";
      hintLine.textContent = "Hisobingiz yo‘q bo‘lsa, Sign up ni bosing.";
      signInEmail.focus();
    } else {
      tabSignUp.classList.add("active");
      tabSignIn.classList.remove("active");
      signUpForm.classList.remove("hidden");
      signInForm.classList.add("hidden");
      authTopLine.textContent = "Ro‘yxatdan o‘tish";
      hintLine.textContent = "Hisobingiz bo‘lsa, Sign in ni bosing.";
      signUpEmail.focus();
    }
  }

  // Default: Sign up
  setMode("up");

  tabSignUp.addEventListener("click", () => setMode("up"));
  tabSignIn.addEventListener("click", () => setMode("in"));

  // ===== Supabase init (safe) =====
  const SUPABASE_URL = "PASTE_YOUR_SUPABASE_URL_HERE";
  const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

  let supabaseClient = null;

  try {
    if (!SUPABASE_URL.startsWith("https://") || SUPABASE_ANON_KEY.includes("PASTE_")) {
      throw new Error("Supabase URL/anon key qo‘yilmagan yoki noto‘g‘ri.");
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    setStatus(signUpStatus, `Xato: ${e.message}`);
    setStatus(signInStatus, `Xato: ${e.message}`);
    // UI baribir ishlaydi; auth funksiyalari esa ishlamaydi.
    return;
  }

  // Agar allaqachon login bo‘lsa, indexga qaytar
  (async () => {
    try {
      const { data } = await supabaseClient.auth.getSession();
      if (data?.session?.user) goHome();
    } catch {
      // ignore
    }
  })();

  // Sign up
  signUpForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = safeTrim(signUpEmail.value);
    const password = safeTrim(signUpPassword.value);
    if (!email || !password) return;

    setStatus(signUpStatus, "Account yaratilmoqda...");

    const { error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/index.html`,
      },
    });

    if (error) {
      setStatus(signUpStatus, `Xato: ${error.message}`);
      return;
    }

    // Session bo‘lsa darhol kirgan bo‘ladi
    const { data } = await supabaseClient.auth.getSession();
    if (data?.session?.user) {
      setStatus(signUpStatus, "Account created ✅ Redirecting...");
      goHome();
      return;
    }

    // Session bo‘lmasa: email confirmation yoq bo‘lishi mumkin yoki boshqa policy
    setStatus(signUpStatus, "Account created ✅ Endi Sign in qiling (yoki email tasdiqlash bo‘lishi mumkin).");
    setMode("in");
    signInEmail.value = email;
    signInPassword.focus();
  });

  // Sign in
  signInForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = safeTrim(signInEmail.value);
    const password = safeTrim(signInPassword.value);
    if (!email || !password) return;

    setStatus(signInStatus, "Kirilmoqda...");

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus(signInStatus, `Xato: ${error.message}`);
      return;
    }

    setStatus(signInStatus, "Signed in ✅ Redirecting...");
    goHome();
  });
});
