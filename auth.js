/* ===========
  auth.js (A-variant)
  - Default: Sign up
  - Account bo‘lsa: Sign in tab
  - Login bo‘lsa: index.html ga avtomatik redirect
=========== */

const SUPABASE_URL = "https://ymkodbrbeqiagkbowvde.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eJPZtkvStgEY1D35FmANsA_lg6LO2y-";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

function safeTrim(s) {
  return (s || "").trim();
}

function setStatus(node, msg) {
  node.className = "status muted";
  node.textContent = msg;
}

function clearStatuses() {
  setStatus(signUpStatus, "");
  setStatus(signInStatus, "");
}

function goHome() {
  // Doim bir xil hostda qaytadi (production URL bo‘lsa ideal)
  window.location.href = `${window.location.origin}/index.html`;
}

function setMode(mode /* 'up' | 'in' */) {
  clearStatuses();

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

/* Default: Sign up */
setMode("up");

/* Agar session bo‘lsa, darhol indexga */
(async function boot() {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) goHome();
  } catch {
    // ignore
  }
})();

tabSignUp.addEventListener("click", () => setMode("up"));
tabSignIn.addEventListener("click", () => setMode("in"));

signUpForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = safeTrim(signUpEmail.value);
  const password = safeTrim(signUpPassword.value);
  if (!email || !password) return;

  setStatus(signUpStatus, "Account yaratilmoqda...");

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    setStatus(signUpStatus, `Xato: ${error.message}`);
    return;
  }

  // Session bo‘lsa darhol indexga, bo‘lmasa confirmation yoq bo‘lishi mumkin
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    setStatus(signUpStatus, "Account created ✅ Redirecting...");
    goHome();
  } else {
    setStatus(signUpStatus, "Account created ✅ (Email confirmation yoqilgan bo‘lishi mumkin). Endi Sign in qiling.");
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

  setStatus(signInStatus, "Signed in ✅ Redirecting...");
  goHome();
});
