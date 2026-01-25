// config.js - LearnCard konfiguratsiya
// MUHIM: Bu faylni o'z Supabase ma'lumotlaringiz bilan yangilang!

window.APP_CONFIG = {
  // Supabase Project Settings -> API -> Project URL
  SUPABASE_URL: "https://ymkodbrbeqiagkbowvde.supabase.co",
  
  // Supabase Project Settings -> API -> Project API keys -> anon public
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlta29kYnJiZXFpYWdrYm93dmRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc4OTcyMzIsImV4cCI6MjA1MzQ3MzIzMn0.uP5aEJCKGvCZx_4KfYLh8VLFqz9OOYpvW-S8rZG0234",
  
  // Cloudflare Worker URL (wrangler deploy qilganingizdan keyin)
  // Format: https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev
  OCR_WORKER_URL: "https://learncard-ocr.asdovasd446.workers.dev",
};

/*
==============================================
📋 SOZLASH YO'RIQNOMASI
==============================================

1️⃣ SUPABASE SOZLASH:
   - https://supabase.com ga kiring
   - New Project yarating
   - Project Settings -> API ga o'ting
   - Project URL va anon/public key'ni nusxalang
   - Yuqoridagi SUPABASE_URL va SUPABASE_ANON_KEY ga joylashtiring

2️⃣ SUPABASE DATABASE SCHEMA:
   SQL Editor'da quyidagi kodni ishga tushiring:

   -- vocab_chats jadvali
   CREATE TABLE vocab_chats (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID REFERENCES auth.users NOT NULL,
     title TEXT NOT NULL,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   -- vocab_cards jadvali
   CREATE TABLE vocab_cards (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID REFERENCES auth.users NOT NULL,
     chat_id UUID REFERENCES vocab_chats(id) ON DELETE CASCADE,
     en TEXT NOT NULL,
     uz TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   -- RLS (Row Level Security) yoqish
   ALTER TABLE vocab_chats ENABLE ROW LEVEL SECURITY;
   ALTER TABLE vocab_cards ENABLE ROW LEVEL SECURITY;

   -- RLS policies
   CREATE POLICY "Users can CRUD own chats"
     ON vocab_chats FOR ALL
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);

   CREATE POLICY "Users can CRUD own cards"
     ON vocab_cards FOR ALL
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);

3️⃣ CLOUDFLARE WORKER SOZLASH:
   - worker/src/index.js faylini yarating (quyida berilgan)
   - wrangler.toml yarating
   - Cloudflare account yarating
   - Terminal: wrangler login
   - Terminal: wrangler deploy
   - Deploy qilingan URL'ni OCR_WORKER_URL ga joylashtiring

4️⃣ OCR.SPACE API KEY:
   - https://ocr.space/ocrapi ga o'ting
   - Free API key oling (25,000 requests/month)
   - Cloudflare Dashboard -> Workers -> Settings -> Variables
   - OCR_SPACE_API_KEY o'zgaruvchisini qo'shing

==============================================
*/