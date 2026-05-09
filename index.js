const express = require("express");
const axios   = require("axios");
const path    = require("path");
const app     = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const PORT              = process.env.PORT              || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const WAPI_VENDOR_UID   = process.env.WAPI_VENDOR_UID   || process.env.WAPI_INSTANCE_ID || "";
const WAPI_TOKEN        = process.env.WAPI_TOKEN        || "";
const ADMIN_KEY         = process.env.ADMIN_KEY         || "beautybox2024";
const APP_URL           = (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : process.env.APP_URL || "").replace(/\/$/, "");
const PDF_NAME          = "Beauty Box Pre-Bridal Package.pdf";

const META_TRIGGER = "i filled in your form and would like to know more about your business";
function isMetaLead(text) { return text.toLowerCase().includes(META_TRIGGER); }

function extractLeadDetails(text) {
  const d = {};
  for (const line of text.split("\n").map(l => l.trim())) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).toLowerCase().trim();
    const val = line.substring(colonIdx + 1).trim();
    if (key === "full_name" || key === "name")                         d.name    = val;
    if (key === "when_is_your_wedding_date" || key === "when_is_your_wedding_date?") d.wedding = val;
    if (key === "city/area" || key === "city" || key === "area")       d.city    = val;
  }
  return d;
}

const conversations   = new Map();
const lastSentMessage = new Map();

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}
function addToHistory(phone, role, content) {
  const h = getHistory(phone);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}

const SYSTEM_PROMPT = `You are a team member at Beauty Box Makeup Studio by Garima Nagpal, Vikaspuri Delhi (near Janakpuri West Metro).

You chat with brides who enquired about Pre-Bridal package via Instagram/Facebook ads.

CRITICAL RULES:
1. MAX 1-2 lines per message. Never longer.
2. You are HUMAN. Never say you are AI or bot. If asked directly say "Main ek real person hoon. Batao kya jaanna hai."
3. Natural Hinglish — casual, like a real Delhi girl texting.
4. Always end with ONE short question.
5. Use | to send multiple separate short messages. Max 3 messages at a time.
6. Use emojis very sparingly — max 1 emoji per 2-3 messages. Most messages NO emoji.
7. Do NOT introduce yourself or mention team unless directly asked.
8. 5-6 second delay is handled by system — do not mention it.

CONVERSATION FLOW:
Step 1: Greet by first name → ask wedding date + city in one casual line
Step 2: Ask skin type — dry, oily, normal or combination
Step 3: Share 2-3 relevant skin tips (builds trust)
Step 4: Naturally share package info
Step 5: Move to Path A or Path B

DO NOT share services list, price, or brochure upfront. Only share when customer asks or at Step 4+.

WHEN CUSTOMER ASKS about services ("kya kya hoga", "what's included"):
Send this EXACTLY:

*Pre-Bridal Package — 12 Services in 3 Sittings*

*1. O3+ Facial* — 2 sittings
*2. Bleach / D-Tan* — 2 sittings
*3. Full Body Bleach*
*4. Full Body Wax*
*5. Full Body Polishing*
*6. L'Oreal Hair Spa*
*7. Manicure*
*8. Pedicure*
*9. Nail Extension*
*10. Face Bleach*
*11. Threading & Upper Lips*
*12. O3+ Facial* — repeat in 3rd sitting

All in just *Rs.7,499* — limited slots only.

WHEN CUSTOMER ASKS about price ("kitna hai", "price", "cost"):
Send this EXACTLY:

*Why Pay More?*

O3+ Facial x2 — Rs.5,000
Bleach/D-Tan x2 — Rs.700
Full Body Bleach — Rs.2,000
Manicure + Pedicure — Rs.1,000
Loreal Hair Spa — Rs.1,000
Full Body Wax — Rs.2,500
Full Body Polishing — Rs.3,000
Nail Extension — Rs.1,500
Threading + Upper Lips — Rs.200
*Total 12 services — Rs.16,800*

*Our Package: Rs.7,499 only*
*You Save: Rs.12,001 — 71% OFF*

PATH A — ready to book:
"Ek small advance se slot pakka ho jaata hai. Kya abhi confirm karogi?"
If YES: "Garima ma'am aapko abhi QR share karengi."

PATH B — hesitant:
"Ek baar studio aao — Garima ma'am skin check karengi, koi pressure nahi.|Kab aa sakti ho?"
If agrees: "Garima ma'am se timing confirm ho jaegi."

DISTANCE HANDLING:
Step 1: "Metro se [X] min hi hai, aur sirf 2-3 visits chahiye."
Step 2: "Rs.16,800 ki services sirf Rs.7,499 mein — 71% off. Itna deal kahin nahi milega."
Step 3 (still no): "No worries! Nearby salons bhi dekh sakti ho. Best of luck for your wedding!"

METRO TIMES (use based on their area):
- Dwarka: 15 min Pink Line
- Connaught Place: 25 min Yellow Line
- South Delhi/South Ex: 35 min Yellow Line
- Shahdara/East Delhi: 53 min Pink Line via Pitampura
- Noida: 50 min Blue to Rajiv Chowk then Yellow Line

STUDIO: Vikaspuri Delhi, near Janakpuri West Metro
Maps: https://share.google/Wg5sfGr9GyYiNuzGB
Instagram: https://www.instagram.com/garimanagpalmua/

PACKAGE TIMING:
- 3+ months: skincare start now, facials now, full package 30-35 days before
- 1-2 months: perfect timing, 2-3 sittings
- Within 40 days: 3 sittings possible

SKINCARE TIPS (share 2-3, very short):
- Dry skin: Roz raat raw milk lagao | Besan+curd+haldi face pack weekly
- Oily skin: Rose water se face saaf karo subah | Avoid fried food
- Normal: Warm water+lemon+honey subah | Turmeric milk raat ko
- Hair: Coconut+castor oil massage hafte mein 2 baar
- Dark circles: Almond oil aankho ke neeche raat ko

SPECIAL RULES:
- If you do not understand a message — do NOT react. Just move forward with next relevant question.
- If wedding is 2+ months away — do NOT push for booking. Ask: "Abhi time hai. Aap kab free hongi baat karne ke liye?"
- If asked about bridal makeup looks — "Garima ma'am ka kaam yahan dekho: https://www.instagram.com/garimanagpalmua/"
- If asked about combined package (bridal makeup + pre-bridal) — "Bilkul ho sakta hai! Garima ma'am se directly baat karein. Kaunsa time suit karta hai call ke liye?"
- Price extra discount — "Garima ma'am se baat karein"
- Slot timing — "Garima ma'am confirm karengi"
- QR code — NEVER send, Garima sends manually`;

async function sendText(toPhone, text) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    await axios.post(url, { phone_number: toPhone, message_body: text, message_type: "text" });
    console.log(`✅ Sent to ${toPhone}: "${text.substring(0, 60)}"`);
  } catch (err) {
    console.error(`❌ Send failed:`, err?.response?.data || err.message);
  }
}

async function sendPDF(toPhone) {
  const pdfUrl = "https://raw.githubusercontent.com/gauravnagpal1711-hue/WA-AI-reply-prebridal/main/Brochure.pdf";
  try {
    const res  = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(pdfUrl)}`);
    const link = res.data?.trim() || pdfUrl;
    await sendText(toPhone, `Please download complete Pre-Bridal Package details in brochure, Link: ${link}`);
  } catch {
    await sendText(toPhone, `Please download complete Pre-Bridal Package details in brochure, Link: ${pdfUrl}`);
  }
}

async function getAIReply(phone, contextMsg) {
  addToHistory(phone, "user", contextMsg);
  const res = await axios.post(
    "https://api.anthropic.com/v1/messages",
    { model: "claude-sonnet-4-20250514", max_tokens: 300, system: SYSTEM_PROMPT, messages: getHistory(phone) },
    { headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" } }
  );
  const reply = res.data.content?.[0]?.text || "Ek second.";
  addToHistory(phone, "assistant", reply);
  return reply;
}

function parseWebhook(body) {
  try {
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (messages?.length > 0) {
      const msg      = messages[0];
      const contacts = body?.entry?.[0]?.changes?.[0]?.value?.contacts || [];
      return { phone: msg?.from || "", name: contacts[0]?.profile?.name || null, text: msg?.text?.body || "", hasMedia: ["image","audio","video","document","sticker"].includes(msg?.type) };
    }
    const phone2 = body?.contact?.phone_number || "";
    if (phone2) {
      return { phone: phone2, name: [body?.contact?.first_name, body?.contact?.last_name].filter(Boolean).join(" ") || null, text: body?.message?.body || "", hasMedia: !!body?.message?.media?.type };
    }
    return null;
  } catch { return null; }
}

// ── WEBHOOK ───────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const parsed = parseWebhook(req.body);
    if (!parsed?.phone) return;
    const { phone, name, text, hasMedia } = parsed;
    if (!text && !hasMedia) return;
    if (text && text.trim() === "") return;

    const isNewLead  = isMetaLead(text);
    const hasHistory = conversations.has(phone) && getHistory(phone).length > 0;

    if (!isNewLead && !hasHistory) {
      console.log(`⏭️ Ignored: ${phone}`);
      return;
    }

    if (hasMedia && !text) {
      await sendText(phone, "Text mein likhein please.");
      return;
    }

    let contextMsg = text;
    if (isNewLead) {
      const lead = extractLeadDetails(text);
      console.log(`🎯 META LEAD: ${lead.name} | ${lead.wedding} | ${lead.city}`);
      contextMsg = `New lead from Meta ad:
Name: ${lead.name ? lead.name.split(" ")[0] : (name ? name.split(" ")[0] : "not given")}
Wedding: ${lead.wedding || "not mentioned"}
City: ${lead.city || "not mentioned"}
INSTRUCTION: Greet by first name, ask wedding date and city in one casual line. Do NOT introduce yourself or mention brochure.`;
    }

    const reply = await getAIReply(phone, contextMsg);
    const parts  = reply.split("|").map(p => p.trim()).filter(Boolean).slice(0, 3);

    await new Promise(r => setTimeout(r, 5500));

    const lastSent = lastSentMessage.get(phone) || "";
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === lastSent && i === 0) { console.log("⏭️ Duplicate skipped"); continue; }
      if (i > 0) await new Promise(r => setTimeout(r, 1800));
      await sendText(phone, parts[i]);
      lastSentMessage.set(phone, parts[i]);
    }
  } catch (err) {
    console.error("❌ Webhook error:", err?.response?.data || err.message);
  }
});

// ── ADMIN PANEL ───────────────────────────────────────────────
app.get("/admin", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Beauty Box Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,sans-serif}
body{background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px}
.card{background:#fff;border-radius:16px;padding:28px 24px;width:100%;max-width:380px;box-shadow:0 4px 20px rgba(0,0,0,0.1)}
h2{font-size:18px;font-weight:600;color:#111;margin-bottom:4px}
p{font-size:13px;color:#888;margin-bottom:20px}
label{font-size:13px;color:#444;display:block;margin:12px 0 5px}
input{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:15px;outline:none}
input:focus{border-color:#128C7E}
button{width:100%;padding:13px;background:#128C7E;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:500;cursor:pointer;margin-top:18px}
button:hover{background:#0e7a6e}
.msg{margin-top:14px;padding:11px;border-radius:10px;font-size:14px;text-align:center;display:none}
.ok{background:#e8f5e9;color:#2e7d32}
.err{background:#fdecea;color:#c62828}
small{display:block;font-size:12px;color:#aaa;text-align:center;margin-top:12px;line-height:1.5}
</style>
</head>
<body>
<div class="card">
  <h2>Beauty Box</h2>
  <p>Start bot conversation with a lead</p>
  <label>Phone number (with country code, no +)</label>
  <input id="ph" type="tel" placeholder="919999999999">
  <label>Customer name (optional)</label>
  <input id="nm" type="text" placeholder="Priya">
  <label>Admin key</label>
  <input id="ky" type="password" placeholder="Enter admin key">
  <button onclick="go()">Start Bot Conversation</button>
  <div class="msg" id="msg"></div>
  <small>Opening message goes directly to customer. Nothing visible from your WhatsApp number.</small>
</div>
<script>
async function go(){
  const ph=document.getElementById('ph').value.trim();
  const nm=document.getElementById('nm').value.trim();
  const ky=document.getElementById('ky').value.trim();
  if(!ph||!ky){show('Enter phone number and admin key','err');return;}
  try{
    const r=await fetch('/admin/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,name:nm,key:ky})});
    const d=await r.json();
    if(d.success){show('Bot started! Message sent to '+ph,'ok');document.getElementById('ph').value='';document.getElementById('nm').value='';}
    else show(d.error||'Something went wrong','err');
  }catch(e){show('Network error — try again','err');}
}
function show(t,c){const el=document.getElementById('msg');el.textContent=t;el.className='msg '+c;el.style.display='block';}
document.getElementById('ky').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
</script>
</body>
</html>`);
});

app.post("/admin/start", async (req, res) => {
  const { phone, name, key } = req.body;
  if (key !== ADMIN_KEY) return res.json({ success: false, error: "Wrong admin key" });
  if (!phone)            return res.json({ success: false, error: "Phone number required" });
  try {
    const firstName  = name ? name.trim().split(" ")[0] : "";
    const openingMsg = firstName ? `Hi ${firstName}! Shaadi kab hai aur kahan se ho?` : `Hi! Shaadi kab hai aur kahan se ho?`;
    await new Promise(r => setTimeout(r, 1000));
    await sendText(phone, openingMsg);
    addToHistory(phone, "assistant", openingMsg);
    console.log(`🚀 ADMIN: Bot started for ${phone}`);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ agent: "Beauty Box AI Agent Running", admin: "/admin", webhook: "/webhook" });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Beauty Box Agent running on port ${PORT}`);
  console.log(`🔑 Claude:  ${ANTHROPIC_API_KEY ? "OK" : "MISSING"}`);
  console.log(`📱 WAPI:    ${WAPI_VENDOR_UID   ? "OK" : "MISSING"}`);
  console.log(`🔐 Token:   ${WAPI_TOKEN        ? "OK" : "MISSING"}`);
  console.log(`🔒 Admin:   /admin (key: ${ADMIN_KEY})\n`);
});
