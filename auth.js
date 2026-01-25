// auth.js — LearnCard autentifikatsiya sahifasi logikasi

document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.APP_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || "";

  // Config tekshirish
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    alert("⚠️ Config xato! config.js faylini tekshiring.");
    console.error("Missing config:", { SUPABASE_URL, SUPABASE_ANON_KEY });
    return;
  }

  if (!SUPABASE_URL.startsWith("https://") || SUPABASE_ANON_KEY.length < 10) {
    alert("⚠️ Supabase config noto'g'ri! config.js ni tekshiring.");
    console.error("Invalid config:", { SUPABASE_URL, SUPABASE_ANON_KEY });
    return;
  }

  // Supabase client yaratish
  const supabase = window.supabase.createClient(
    SUPABASE_URL, 
    SUPABASE_ANON_KEY, 
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
    signUpStatus.textContent = "";
  });

  tabSignIn.addEventListener("click", () => {
    setMode("in");
    window.location.hash = "";
    signInStatus.textContent = "";
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
    
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        console.error("Sign up error:", error);
        signUpStatus.textContent = `❌ ${error.message}`;
        return;
      }

      console.log("Sign up success:", data);

      // Supabase v2: auto-confirm email (agar sozlamada yoqilgan bo'lsa)
      if (data?.user && data?.session) {
        signUpStatus.textContent = "✅ Account created! Redirecting...";
        setTimeout(() => {
          window.location.href = "./index.html";
        }, 1000);
      } else {
        // Email confirmation kerak bo'lgan holat
        signUpStatus.textContent = "✅ Account created! Check your email to confirm, then sign in.";
        setTimeout(() => {
          setMode("in");
          signInEmail.value = email;
        }, 2000);
      }
    } catch (err) {
      console.error("Sign up exception:", err);
      signUpStatus.textContent = `❌ Xato: ${err.message || err}`;
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
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error("Sign in error:", error);
        signInStatus.textContent = `❌ ${error.message}`;
        return;
      }

      console.log("Sign in success:", data);

      if (data?.user) {
        signInStatus.textContent = "✅ Success! Redirecting...";
        setTimeout(() => {
          window.location.href = "./index.html";
        }, 500);
      }
    } catch (err) {
      console.error("Sign in exception:", err);
      signInStatus.textContent = `❌ Xato: ${err.message || err}`;
    }
  });

  // Agar allaqachon sign in bo'lgan bo'lsa
  (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user) {
        console.log("Already signed in, redirecting...");
        window.location.href = "./index.html";
      }
    } catch (err) {
      console.error("Session check error:", err);
    }
  })();
});