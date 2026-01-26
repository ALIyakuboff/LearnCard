document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.APP_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || "";

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
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
  }

  setMode((window.location.hash || "").includes("signup") ? "up" : "in");
  tabSignUp.addEventListener("click", () => setMode("up"));
  tabSignIn.addEventListener("click", () => setMode("in"));

  function setStatus(node, msg) {
    if (node) node.textContent = msg || "";
  }

  async function checkReachability() {
    // Health check (tarmoq muammosini aniq ko‘rsatadi)
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, { method: "GET" });
      return r.ok;
    } catch {
      return false;
    }
  }

  signUpForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus(signUpStatus, "Creating...");

    const ok = await checkReachability();
    if (!ok) {
      setStatus(signUpStatus, "❌ Network: Supabase serveriga ulanib bo‘lmadi (Failed to fetch). QUIC/Proxy/Antivirus tekshiring.");
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: signUpEmail.value.trim(),
      password: signUpPassword.value.trim(),
    });

    if (error) return setStatus(signUpStatus, `❌ ${error.message}`);
    setStatus(signUpStatus, "✅ Account created. Now sign in.");
    setMode("in");
    signInEmail.value = signUpEmail.value.trim();
  });

  signInForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus(signInStatus, "Signing in...");

    const ok = await checkReachability();
    if (!ok) {
      setStatus(signInStatus, "❌ Network: Supabase serveriga ulanib bo‘lmadi (Failed to fetch). QUIC/Proxy/Antivirus tekshiring.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: signInEmail.value.trim(),
      password: signInPassword.value.trim(),
    });

    if (error) return setStatus(signInStatus, `❌ ${error.message}`);
    window.location.href = "./index.html";
  });
});
