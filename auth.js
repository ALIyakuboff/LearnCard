document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.APP_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || "";

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const el = (id) => document.getElementById(id);
  const safeTrim = (s) => (s || "").trim();

  const alreadyPanel = el("alreadyPanel");
  const alreadyText = el("alreadyText");
  const continueBtn = el("continueBtn");
  const logoutBtn = el("logoutBtn");

  const tabsBlock = el("tabsBlock");
  const formsPanel = el("formsPanel");

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

  function setStatus(node, msg) {
    if (!node) return;
    node.textContent = msg || "";
  }
  function goHome() {
    window.location.href = `${window.location.origin}/index.html`;
  }
  function setMode(mode) {
    setStatus(signUpStatus, "");
    setStatus(signInStatus, "");
    if (mode === "in") {
      signInForm.classList.remove("hidden");
      signUpForm.classList.add("hidden");
      tabSignIn.classList.add("active");
      tabSignUp.classList.remove("active");
    } else {
      signUpForm.classList.remove("hidden");
      signInForm.classList.add("hidden");
      tabSignUp.classList.add("active");
      tabSignIn.classList.remove("active");
    }
  }

  const wantsSignup = (window.location.hash || "").toLowerCase().includes("signup");
  setMode(wantsSignup ? "up" : "in");

  tabSignUp.addEventListener("click", () => setMode("up"));
  tabSignIn.addEventListener("click", () => setMode("in"));

  (async () => {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user;
    if (user) {
      alreadyPanel.classList.remove("hidden");
      formsPanel.classList.add("hidden");
      tabsBlock.classList.add("hidden");
      alreadyText.textContent = `Signed in as: ${user.email}`;
    }
  })();

  continueBtn?.addEventListener("click", () => goHome());

  logoutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    alreadyPanel.classList.add("hidden");
    formsPanel.classList.remove("hidden");
    tabsBlock.classList.remove("hidden");
    setMode("in");
  });

  signUpForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = safeTrim(signUpEmail.value);
    const password = safeTrim(signUpPassword.value);

    setStatus(signUpStatus, "Creating account...");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return setStatus(signUpStatus, `Error: ${error.message}`);

    // might require email confirmation; try session
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) return goHome();

    setStatus(signUpStatus, "Account created. Now Sign in.");
    setMode("in");
    signInEmail.value = email;
  });

  signInForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = safeTrim(signInEmail.value);
    const password = safeTrim(signInPassword.value);

    setStatus(signInStatus, "Signing in...");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setStatus(signInStatus, `Error: ${error.message}`);

    goHome();
  });
});
