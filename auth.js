document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.APP_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || "";

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

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
  function goHome() { window.location.href = `${window.location.origin}/index.html`; }

  function setMode(mode) {
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

  // sanity
  if (!SUPABASE_URL.startsWith("https://") || SUPABASE_ANON_KEY.length < 10) {
    setStatus(signUpStatus, "Supabase config noto‘g‘ri. config.js ni tekshiring.");
    setStatus(signInStatus, "Supabase config noto‘g‘ri. config.js ni tekshiring.");
    return;
  }

  setMode("up");
  tabSignUp.addEventListener("click", () => setMode("up"));
  tabSignIn.addEventListener("click", () => setMode("in"));

  // already logged in?
  (async () => {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) goHome();
  })();

  signUpForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = safeTrim(signUpEmail.value);
    const password = safeTrim(signUpPassword.value);
    if (!email || !password) return;

    setStatus(signUpStatus, "Account yaratilmoqda...");

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/index.html` },
    });

    if (error) {
      setStatus(signUpStatus, `Xato: ${error.message}`);
      return;
    }

    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) {
      setStatus(signUpStatus, "Account created ✅ Redirecting...");
      goHome();
    } else {
      setStatus(signUpStatus, "Account created ✅ Endi Sign in qiling (yoki email tasdiqlash bo‘lishi mumkin).");
      setMode("in");
      signInEmail.value = email;
      signInPassword.focus();
    }
  });

  signInForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = safeTrim(signInEmail.value);
    const password = safeTrim(signInPassword.value);
    if (!email || !password) return;

    setStatus(signInStatus, "Kirilmoqda...");

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus(signInStatus, `Xato: ${error.message}`);
      return;
    }

    // verify session exists
    const { data } = await supabase.auth.getSession();
    if (!data?.session?.user) {
      setStatus(signInStatus, "Login bo‘ldi, lekin session olinmadi. Brauzer cookie/storage bloklangan bo‘lishi mumkin.");
      return;
    }

    setStatus(signInStatus, "Signed in ✅ Redirecting...");
    goHome();
  });
});
