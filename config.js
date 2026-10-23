/* ==============================================================
   PINKEYS — config.js
   The ONE place the website learns where the API lives.
   Put your Render address here (no trailing slash). It is public
   on purpose: the website only calls the public endpoints
   (/health, /identify, /collect), so there is no API key in the
   website at all. The admin key exists only on Render.
   ============================================================== */
window.PINKEYS_CONFIG = {
  API_URL: "https://pinkeys-api.onrender.com",
  SUPABASE_URL: "https://snjszrhekxwjibxkaltm.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNuanN6cmhla3h3amlieGthbHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxOTk5MTgsImV4cCI6MjEwNzc3NTkxOH0.AFIrJiSuXRqPw4-C66M2bwF78d0CBWmIPaA7x18Vw6M"
};
