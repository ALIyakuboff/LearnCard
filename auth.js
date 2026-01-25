// auth.js — LearnCard autentifikatsiya sahifasi logikasi

document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.APP_CONFIG || {};
  
  // Config tekshirish
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    alert("⚠️ Config xato! config.js faylini tekshiring.");
    return;
  }

  const supabase = window.supabase.createClient(
    cfg.SUPABASE_URL, 
    cfg.SUPABASE_ANON_KEY, 
    {
      auth: { 
        persistSession: true, 
        autoRefreshToken: true, 
        detectSessionInUrl: true 
      },
    }
  );

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

  // URL hash orqali mode aniqlash
  const initialMode = (window.location.hash || "").includes("signup") ? "up" : "in";
  setMode(initialMode);

  tabSignUp.addEventListener("click", () => {
    setMode("up");
    window.location.hash = "#signup";
  });

  tabSignIn.addEventListener("click", () => {
    setMode("in");
    window.location.hash = "";
  });

  // Sign Up
  signUpForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const email = signUpEmail.value.trim();
    const password = signUpPassword.value.trim();

    if (!email || !password) {
      signUpStatus.textContent = "⚠️ Email va parol kiriting.";
      return;
    }

    if (password.length < 6) {
      signUpStatus.textContent = "⚠️ Parol kamida 6 ta belgi bo'lishi kerak.";
      return;
    }

    signUpStatus.textContent = "🔄 Creating account...";
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      signUpStatus.textContent = `❌ ${error.message}`;
      return;
    }

    // Supabase v2: auto-confirm email (agar sozlamada yoqilgan bo'lsa)
    if (data?.user && data?.session) {
      signUpStatus.textContent = "✅ Account created! Redirecting...";
      setTimeout(() => {
        window.location.href = "./index.html";
      }, 1000);
    } else {
      signUpStatus.textContent = "✅ Account created! Now sign in.";
      setMode("in");
      signInEmail.value = email;
    }
  });

  // Sign In
  signInForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const email = signInEmail.value.trim();
    const password = signInPassword.value.trim();

    if (!email || !password) {
      signInStatus.textContent = "⚠️ Email va parol kiriting.";
      return;
    }

    signInStatus.textContent = "🔄 Signing in...";
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      signInStatus.textContent = `❌ ${error.message}`;
      return;
    }

    if (data?.user) {
      signInStatus.textContent = "✅ Success! Redirecting...";
      setTimeout(() => {
        window.location.href = "./index.html";
      }, 500);
    }
  });

  // Agar allaqachon sign in bo'lgan bo'lsa
  (async () => {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) {
      window.location.href = "./index.html";
    }
  })();
});