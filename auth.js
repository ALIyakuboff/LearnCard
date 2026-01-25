document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.APP_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
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

  signUpForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    signUpStatus.textContent = "Creating...";
    const { error } = await supabase.auth.signUp({
      email: signUpEmail.value.trim(),
      password: signUpPassword.value.trim(),
    });
    if (error) return (signUpStatus.textContent = error.message);
    signUpStatus.textContent = "Account created. Now sign in.";
    setMode("in");
    signInEmail.value = signUpEmail.value.trim();
  });

  signInForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    signInStatus.textContent = "Signing in...";
    const { error } = await supabase.auth.signInWithPassword({
      email: signInEmail.value.trim(),
      password: signInPassword.value.trim(),
    });
    if (error) return (signInStatus.textContent = error.message);
    window.location.href = "./index.html";
  });
});
