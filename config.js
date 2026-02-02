// config.js
window.APP_CONFIG = {
  SUPABASE_URL: "https://ymkodbrbeqiagkbowvde.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlta29kYnJiZXFpYWdrYm93dmRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwOTAyMzUsImV4cCI6MjA4NDY2NjIzNX0.R__mRxGReGJIYTCwwymxPqJ9YRHNFcg5_ARsaiBTt_k",

  // ✅ 3 ta alohida Cloudflare hisobi uchun OCR URL'lar
  OCR_WORKER_URLS: {
    beginner: "https://learncard-ocr.asdovasd446.workers.dev",
    intermediate: "https://learncard-ocr.asdov52.workers.dev",
    ielts: "https://learncard-ocr.ziyokor.workers.dev" // 3-hisob (YANGILANDI ✅)
  },

  // ✅ 3 ta alohida Cloudflare hisobi uchun Translate URL'lar (YANGI ✨)
  TRANSLATE_WORKER_URLS: {
    beginner: "https://learncard-translate.asdovasd446.workers.dev",
    intermediate: "https://learncard-translate.asdov52.workers.dev", // 2-hisob (YANGILANDI ✨)
    ielts: "https://learncard-translate.ziyokor.workers.dev" // 3-hisob (YANGILANDI ✅)
  },

  // Eski GAS URL (Fallback sifatida qoladi)
  GAS_TRANSLATE_URL: "https://script.google.com/macros/s/AKfycbwU25xoSCC38egP4KnblHvrW88gwJwi2kLEL9O7DDpsmOONBxd4KRi3EnY9xndBxmcS/exec",

  BUILD: "2026-02-02-SCALE-MODE-V3"
};
