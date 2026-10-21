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
};
