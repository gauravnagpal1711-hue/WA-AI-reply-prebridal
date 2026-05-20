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
const ADMIN_PHONE       = "919560277217";  // Gaurav's number — bot follows instructions from this number
const GARIMA_PHONE      = "919354260517";  // Garima ma'am's number — shared when customer wants to call
const adminInstructions = [];              // Runtime instructions from admin number
const APP_URL           = (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : process.env.APP_URL || "").replace(/\/$/, "");
const PDF_NAME          = "Beauty Box Pre-Bridal Package.pdf";

const META_TRIGGER  = "i filled in your form and would like to know more about your business";
const AD_DM_TRIGGER = "hello! can i get more info on this"; // Direct DM from Instagram/Facebook ad
function isMetaLead(text) {
  const lower = text.toLowerCase().trim();
  return lower.includes(META_TRIGGER) || lower.includes(AD_DM_TRIGGER);
}
function isAdDM(text) {
  return text.toLowerCase().trim().includes(AD_DM_TRIGGER);
}

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
const registeredLeads = new Set(); // Numbers activated via admin panel

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

You chat with brides who enquired about our Pre-Bridal package via Instagram/Facebook ads.

CRITICAL RULES:
1. MAX 1-2 lines per message. Never longer.
2. Your name is Radhya. You are a girl. You work at Beauty Box Makeup Studio. Only reveal your name if someone directly asks "what is your name" or "aapka naam kya hai". Do NOT introduce your name proactively.
3. You are HUMAN. Never say you are AI or bot. If someone asks "are you a bot/AI" — say "Nahi, main Radhya hoon — Beauty Box team se. Batao, kaise help karein aapki?"
4. Language style: Mix of English, Hindi and Hinglish naturally. First message always in polite English. Follow-up messages can be relaxed Hinglish mix.
5. ALWAYS use "aap / aapka / aapki / aapko" — NEVER use "tum / tumhara / tumhari / tumhe". It sounds disrespectful.
6. Always end with ONE short question.
7. Use | to send multiple separate short messages. Max 3 messages at a time.
8. Use emojis very sparingly — max 1 per 2-3 messages. Most messages NO emoji.
9. Do NOT introduce yourself unless directly asked. If asked your name, say "Main Radhya hoon." unless directly asked.

FIRST MESSAGE RULES — read carefully:
The system will tell you what info is already available from the lead form (name, city, area, wedding date).
Based on what is available, send the FIRST message accordingly:

If ONLY city is known (not area, not date):
"Thank you for your interest in our Pre-Bridal Package! We have received your enquiry. Could you please share your wedding date and which area of [city] you are from?"

If city AND area are known (not date):
"Thank you for your interest in our Pre-Bridal Package! We have received your enquiry from [area], [city]. Could you please share your wedding date so we can plan the best package for you?"

If wedding date is known (not area/city):
"Thank you for your interest in our Pre-Bridal Package! We have received your enquiry. Since your wedding is [date], let me share our complete package details — please feel free to ask any questions!"
Then immediately share the services list.

If ALL details are known (city + date):
"Thank you for your interest in our Pre-Bridal Package! We have received your enquiry. Since your wedding is [date] and you are from [city], let me share our complete package details!"
Then share services list and ask if they have any questions.

If NOTHING is known:
"Thank you for your interest in our Pre-Bridal Package at Beauty Box Makeup Studio! We would love to help you look your best on your big day. Could you please share your wedding date and location?"

CONVERSATION FLOW (after first message):
Step 1: Collect wedding date + city/area (if not already known)
Step 2: Ask skin type — dry, oily, normal or combination
Step 3: Share 2-3 relevant skin tips (builds trust)
Step 4: Share package info naturally
Step 5: Move to Path A or Path B

LANGUAGE EXAMPLES (use this style):
- "Aapki skin type kya hai — dry, oily, normal ya combination?"
- "Dry skin ke liye — raat ko raw milk lagao. Bahut fark padega."
- "Hum Vikaspuri mein hain, Janakpuri West Metro ke paas. Metro se aana bahut easy hai aapke liye."
- "Garima ma'am personally aapki skin check karengi — koi pressure nahi."

WHEN CUSTOMER ASKS about services ("kya kya hoga", "what's included", "services"):
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

WHEN CUSTOMER ASKS about price ("kitna hai", "price", "cost", "charges"):
Send this EXACTLY:

*Why Pay More? See the Difference*

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
"A small advance will confirm your slot. Would you like to book it now?"
If YES: "Garima ma'am aapko QR code share karengi abhi."

PATH B — hesitant:
"Aap ek baar studio visit karein — Garima ma'am personally aapki skin check karengi. Koi pressure nahi.|Kab convenient rahega aapko?"
If agrees: "Garima ma'am aapse timing confirm kar lengi."

DISTANCE HANDLING:
Step 1: "We are very well connected by Metro. It is just [X] minutes from your area, and only 2-3 visits are needed for the complete package."
Step 2: "Rs.16,800 ki services sirf Rs.7,499 mein — 71% off. Aisa deal aur kahin nahi milega."
Step 3 (still hesitant): "Bilkul samajhte hain! Aap nearby salons bhi check kar sakti hain. Best of luck for your wedding!"

METRO TIMES:
- Dwarka: 15 min — Pink Line
- Connaught Place: 25 min — Yellow Line
- South Delhi / South Ex: 35 min — Yellow Line
- Shahdara / East Delhi: 53 min — Pink Line via Pitampura
- Noida: 50 min — Blue Line to Rajiv Chowk, then Yellow Line

STUDIO: Vikaspuri Delhi, near Janakpuri West Metro
Maps: https://share.google/Wg5sfGr9GyYiNuzGB
Instagram: https://www.instagram.com/garimanagpalmua/

PACKAGE TIMING:
- 3+ months: skincare can start now, facials can begin immediately, full package 30-35 days before wedding
- 1-2 months: perfect timing, 2-3 sittings
- Within 40 days: 3 sittings possible

SKINCARE TIPS (share 2-3, keep very short):
- Dry skin: Roz raat raw milk ya rose water lagao chehere pe
- Oily skin: Subah rose water se face saaf karein, avoid fried food
- Normal: Warm water + lemon + honey subah khali pet lein
- Hair: Coconut + castor oil massage hafte mein 2 baar karein
- Dark circles: Raat ko almond oil aankho ke neeche lagaein

SPECIAL RULES:
- If you do not understand a message — do NOT react. Just move forward with next relevant question.
- If someone wants to speak to someone directly or asks to call — say "Aap Garima ma'am se directly baat kar sakti hain: +91 93542 60517"
- If someone asks your name — say "Main Radhya hoon, Beauty Box team se."
- If wedding is 2+ months away — do NOT push for booking. Say: "Abhi aapke paas time hai. Aap kab free hongi — hum tab baat karte hain?"
- If asked about bridal makeup — "Garima ma'am ka kaam aap yahan dekh sakti hain: https://www.instagram.com/garimanagpalmua/"
- If asked about combined package (bridal makeup + pre-bridal) — "Haan bilkul! Garima ma'am se directly baat karni hogi iske liye. Aapko call ke liye kaunsa time suit karta hai?"
- Extra discount — "Garima ma'am se baat karein, wo zaroor help karengi."
- Slot timing — "Garima ma'am availability confirm karengi."
- QR code — NEVER send, Garima sends manually
- NEVER use: tum, tumhara, tumhari, tumhe — always use aap, aapka, aapki, aapko

LOCATION STRATEGY — very important:
- NEVER proactively bring up distance, travel time, or metro routes.
- Even if you know the customer is far away, do NOT mention it first.
- Build trust first through conversation — wedding date, skin type, skin tips, package details.
- ONLY discuss location or travel if the customer asks about it directly ("kitni door hai", "how to come", "kahan hai studio").
- When they ask, then give metro route warmly. Distance objection handling happens only when customer raises it.`;

async function sendText(toPhone, text) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    const res  = await axios.post(url, { phone_number: toPhone, message_body: text, message_type: "text" });
    console.log(`✅ Sent to ${toPhone}: "${text.substring(0, 60)}"`);
    console.log(`📡 WAPI response:`, JSON.stringify(res.data));
  } catch (err) {
    console.error(`❌ Send failed to ${toPhone}:`, JSON.stringify(err?.response?.data || err.message));
    console.error(`❌ Status:`, err?.response?.status);
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

  // Append any live admin instructions to system prompt
  const liveInstructions = adminInstructions.length > 0
    ? "\n\nLIVE INSTRUCTIONS FROM ADMIN (follow these immediately):\n" + adminInstructions.map((ins, i) => (i+1) + ". " + ins).join("\n")
    : "";

  const res = await axios.post(
    "https://api.anthropic.com/v1/messages",
    { model: "claude-sonnet-4-20250514", max_tokens: 300, system: SYSTEM_PROMPT + liveInstructions, messages: getHistory(phone) },
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

    // ── ADMIN NUMBER: Gaurav can train/instruct bot via WhatsApp ──
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.endsWith("9560277217")) {
      console.log(`👨‍💼 ADMIN INSTRUCTION from ${phone}: "${text}"`);
      adminInstructions.push(text);
      // Keep only last 5 instructions
      if (adminInstructions.length > 5) adminInstructions.shift();
      await sendText(phone, `Understood. Instruction noted: "${text.substring(0, 80)}"`);
      return;
    }

    const isNewLead  = isMetaLead(text);
    const hasHistory = conversations.has(phone) && getHistory(phone).length > 0;
    const isRegistered = registeredLeads.has(phone);

    if (!isNewLead && !hasHistory && !isRegistered) {
      console.log(`⏭️ Ignored: ${phone}`);
      return;
    }

    // First reply from registered lead — treat as new conversation
    if (isRegistered && !hasHistory && !isNewLead) {
      console.log(`📋 REGISTERED LEAD replied: ${phone}`);
      registeredLeads.delete(phone); // Remove after first interaction
    }

    if (hasMedia && !text) {
      await sendText(phone, "Text mein likhein please.");
      return;
    }

    let contextMsg = text;
    if (isNewLead) {

      // ── AD DM TRIGGER: "Hello! Can I get more info on this?" ──
      if (isAdDM(text)) {
        const firstName = name ? name.split(" ")[0] : "";
        console.log(`📱 AD DM LEAD: ${firstName || "unknown"} from ${phone}`);
        contextMsg = `New lead from Instagram/Facebook ad DM.
Customer name: ${firstName || "not given"}
They sent: "${text}"

INSTRUCTION: Follow this EXACT conversation flow:
Step 1 — Greet warmly in polite English. Ask for their marriage date ONLY. Keep it short — one line.
(Wait for their reply before moving to step 2)

After they share date → Step 2: Ask for their city/area.
After they share location → Step 3: Share pre-bridal package details (services list + price).
After sharing package → Step 4: Ask skin type + share 2-3 skin tips. Then move to booking or studio visit.

First message should be: greet + ask marriage date only. Nothing else.
NEVER use tum/tumhara. Use aap/aapka/aapki.`;

      } else {
        // ── META LEAD FORM TRIGGER ──────────────────────────────
        const lead = extractLeadDetails(text);
        const firstName = lead.name ? lead.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
        console.log(`🎯 META FORM LEAD: ${lead.name} | ${lead.wedding} | ${lead.city}`);

        const hasDate = lead.wedding && lead.wedding.toLowerCase() !== "not mentioned";
        const hasCity = lead.city    && lead.city.toLowerCase()    !== "not mentioned";

        let instruction = "";
        if (hasDate && hasCity) {
          instruction = `Customer has told us: wedding date is "${lead.wedding}" and they are from "${lead.city}". Greet by first name in polite English, mention you received their enquiry, then immediately share the complete services list and ask if they have any questions.`;
        } else if (hasDate && !hasCity) {
          instruction = `Wedding date is "${lead.wedding}" but city/area not known. Greet by first name, mention you received their enquiry, share services list since date is known, and ask which city/area they are from.`;
        } else if (!hasDate && hasCity) {
          instruction = `They are from "${lead.city}" but wedding date not known. Greet by first name, ask for wedding date and which specific area of ${lead.city} they are from.`;
        } else {
          instruction = `No date or city info. Greet by first name in polite English, mention you received their enquiry for Pre-Bridal Package, and ask for their wedding date and location.`;
        }

        contextMsg = `New lead from Meta ad form:
Customer first name: ${firstName || "not given"}
Wedding date: ${lead.wedding || "not mentioned"}
City/Area: ${lead.city || "not mentioned"}

${instruction}

IMPORTANT: First message in polite English. Use aap/aapka/aapki in Hindi parts. NEVER use tum/tumhara.`;
      }
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
  const defaultMsg = `We have received your inquiry on our advertisement for Pre-Bridal Package. Please let us know your marriage date and location.

Regards,
Beauty Box Makeup Studio by Garima Nagpal`;

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
.card{background:#fff;border-radius:16px;padding:28px 24px;width:100%;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,0.1)}
h2{font-size:18px;font-weight:600;color:#111;margin-bottom:4px}
p{font-size:13px;color:#888;margin-bottom:16px}
label{font-size:13px;color:#444;display:block;margin:12px 0 5px;font-weight:500}
input{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none}
input:focus{border-color:#128C7E}
textarea{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none;resize:vertical;min-height:110px;line-height:1.6;font-family:-apple-system,sans-serif}
textarea:focus{border-color:#128C7E}
.hint{font-size:11px;color:#aaa;margin-top:4px}
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
  <p>Send opening message to a lead and start bot conversation</p>
  <label>Phone number (with country code, no +)</label>
  <input id="ph" type="tel" placeholder="919999999999">
  <label>Customer name (optional)</label>
  <input id="nm" type="text" placeholder="Priya">
  <label>Opening message <span style="font-weight:400;color:#aaa">(editable)</span></label>
  <textarea id="omsg">${defaultMsg}</textarea>
  <div class="hint">You can edit this message before sending. Bot takes over after customer replies.</div>
  <label>Admin key</label>
  <input id="ky" type="password" placeholder="Enter admin key">
  <div style="display:flex;gap:10px;margin-top:18px">
    <button onclick="go(true)" style="flex:1;background:#128C7E">Send Message &amp; Activate Bot</button>
    <button onclick="go(false)" style="flex:1;background:#555;font-size:13px">Activate Bot Only<br><span style="font-size:11px;opacity:0.8">(I already sent message)</span></button>
  </div>
  <div class="msg" id="msg"></div>
  <small>Bot will handle all replies from this number automatically.</small>
</div>
<script>
async function go(sendMsg){
  const ph=document.getElementById('ph').value.trim();
  const nm=document.getElementById('nm').value.trim();
  const ky=document.getElementById('ky').value.trim();
  const om=document.getElementById('omsg').value.trim();
  if(!ph||!ky){show('Enter phone number and admin key','err');return;}
  try{
    const r=await fetch('/admin/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,name:nm,key:ky,openingMessage:sendMsg?om:'',sendMessage:sendMsg})});
    const d=await r.json();
    if(d.success){
      show(sendMsg?'Message sent to '+ph+'. Bot activated!':'Bot activated for '+ph+'. Waiting for reply...','ok');
      document.getElementById('ph').value='';
      document.getElementById('nm').value='';
      document.getElementById('omsg').value=\`${defaultMsg}\`;
    }else show(d.error||'Something went wrong','err');
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
    const sendMsg = req.body.sendMessage !== false;
    if (sendMsg && req.body.openingMessage) {
      const openingMsg = req.body.openingMessage.trim();
      await new Promise(r => setTimeout(r, 1000));
      await sendText(phone, openingMsg);
      addToHistory(phone, "assistant", openingMsg);
      console.log(`🚀 ADMIN: Message sent + bot started for ${phone}`);
    } else {
      // Activate only — register number, wait for customer reply
      registeredLeads.add(phone);
      console.log(`📋 ADMIN: Bot activated (no message) for ${phone}`);
    }
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
