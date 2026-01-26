// auth.js
document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.APP_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || "";

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage, // explicit
    },
  });

  const el = (id) => document.getElementById(id);

  const tabSignUp = el("tabSignUp");
  const tabSignIn = el("tabSignIn");

  const signUpForm = el("signUpForm");
  const signInForm = el("signInForm");

  const signUpEmail = el("signUpEmail");
  const signUpPassword = el("signUpPassword");
  const signUpStatus = el("signUpStatus");

  const signInEmail = el("signInEmail");
  const signInPassword = el("signInPassword");
  const signInStatus = el("signInStatus");

  function setMode(mode) {
    tabSignUp.classList.toggle("active", mode === "up");
    tabSignIn.classList.toggle("active", mode === "in");
    signUpForm.classList.toggle("hidden", mode !== "up");
    signInForm.classList.toggle("hidden", mode !== "in");
    signUpStatus.textContent = "";
    signInStatus.textContent = "";
  }

  setMode((window.location.hash || "").includes("signup") ? "up" : "in");

  tabSignUp.addEventListener("click", () => setMode("up"));
  tabSignIn.addEventListener("click", () => setMode("in"));

  async function healthCheck() {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: SUPABASE_ANON_KEY },
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  // (Removed automatic redirect to allow users to access the form)
  /*
  (async () => {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) window.location.href = "./index.html";
  })();
  */

  signUpForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    signUpStatus.textContent = "Checking network...";
    const ok = await healthCheck();
    if (!ok) {
      signUpStatus.textContent = "❌ Network muammo: Supabase’ga ulanib bo‘lmadi (Failed to fetch).";
      return;
    }

    signUpStatus.textContent = "Creating account...";
    const email = signUpEmail.value.trim();
    const password = signUpPassword.value.trim();

    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      signUpStatus.textContent = `❌ ${error.message}`;
      return;
    }

    // In some configs, email confirmation is required, session may be null.
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) {
      window.location.href = "./index.html";
      return;
    }

    signUpStatus.textContent = "✅ Account created. Endi Sign in qiling (yoki emailni tasdiqlang).";
    setMode("in");
    signInEmail.value = email;
    signInPassword.focus();
  });

  signInForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Bypass health check to avoid false positives
    // const ok = await healthCheck();
    // if (!ok) { ... }

    signInStatus.textContent = "Signing in...";
    const email = signInEmail.value.trim();
    const password = signInPassword.value.trim();

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      signInStatus.textContent = `❌ ${error.message}`;
      return;
    }

    // Hard verify session saved
    const { data } = await supabase.auth.getSession();
    if (!data?.session?.user) {
      signInStatus.textContent = "❌ Signed in, lekin session saqlanmadi (storage blok bo‘lishi mumkin).";
      return;
    }

    window.location.href = "./index.html";
  });
});
