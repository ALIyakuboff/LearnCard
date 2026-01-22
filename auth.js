/* ===========
  auth.js (Mobile-first Auth page)
  - Default: Sign up view
  - User has account => switches to Sign in
  - If already logged in => redirect to index.html
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

function setMode(mode /* 'up' | 'in' */) {
  clearStatuses();

  if (mode === "in") {
    // tabs
    tabSignIn.classList.add("active");
    tabSignUp.classList.remove("active");

    // forms
    signInForm.classList.remove("hidden");
    signUpForm.classList.add("hidden");

    authTopLine.textContent = "Kirish";
    hintLine.textContent = "Hisobingiz yo‘q bo‘lsa, Sign up ni bosing.";

    // focus
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

/* Tab handlers */
tabSignUp.addEventListener("click", () => setMode("up"));
tabSignIn.addEventListener("click", () => setMode("in"));

/* If already logged in => go index */
(async function boot() {
  try {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user;
    if (user) {
      window.location.href = "./index.html";
    }
  } catch {
    // ignore
  }
})();

/* Sign up */
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

  // Supabase settingiga qarab: email confirm kerak bo‘lishi mumkin
  setStatus(signUpStatus, "Account created ✅ (Agar confirmation yoqilgan bo‘lsa emailni tasdiqlang.)");

  // Ko‘p holatda user darhol session oladi; shunda indexga yuboramiz
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    window.location.href = "./index.html";
  } else {
    // session bo‘lmasa, userga sign in’ga o‘tishni qulay qilamiz
    setMode("in");
    signInEmail.value = email;
    signInPassword.focus();
  }
});

/* Sign in */
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
  window.location.href = "./index.html";
});
