const express = require("express");
const axios   = require("axios");
const path    = require("path");
const { google } = require("googleapis");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const PORT              = process.env.PORT              || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const WAPI_VENDOR_UID   = process.env.WAPI_VENDOR_UID   || "";
const WAPI_TOKEN        = process.env.WAPI_TOKEN        || "";
const ADMIN_KEY         = process.env.ADMIN_KEY         || "beautybox2024";
const SHEET_ID          = process.env.SHEET_ID          || "";
const ADMIN_PHONE       = "919560277217";
const GARIMA_PHONE      = "919354260517";

// ── GOOGLE SHEETS SETUP ───────────────────────────────────────
let sheetsClient = null;
async function initSheets() {
  try {
    if (!process.env.GOOGLE_CREDENTIALS || !SHEET_ID) {
      console.log("⚠️ Google Sheets disabled — credentials or SHEET_ID missing");
      return;
    }
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth  = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    console.log("📊 Google Sheets connected ✅");

    // Ensure header rows exist
    await ensureHeaders();
  } catch (err) {
    console.error("❌ Sheets init failed:", err.message);
  }
}

async function ensureHeaders() {
  try {
    // Active Leads headers
    const activeHeaders = ["Phone", "Name", "Wedding Date", "City/Area", "Source", "Status", "Last Message", "First Seen", "Last Updated"];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A1:I1",
      valueInputOption: "RAW",
      resource: { values: [activeHeaders] },
    });

    // Followup headers
    const followupHeaders = ["Phone", "Name", "Wedding Date", "City/Area", "Source", "Template Sent", "Sent Date", "Notes"];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "Followup!A1:H1",
      valueInputOption: "RAW",
      resource: { values: [followupHeaders] },
    });
    console.log("📋 Sheet headers verified");
  } catch (err) {
    console.log("⚠️ Header setup skipped:", err.message);
  }
}

// ── SHEET HELPERS ─────────────────────────────────────────────
function nowIST() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

async function findRow(sheetName, phone) {
  if (!sheetsClient) return -1;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A:A`,
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] && rows[i][0].toString().replace(/\D/g, "").endsWith(phone.replace(/\D/g, ""))) {
        return i + 1;
      }
    }
    return -1;
  } catch (err) {
    console.error("findRow error:", err.message);
    return -1;
  }
}

async function addActiveLead(phone, name, wedding, city, source, status, lastMsg) {
  if (!sheetsClient) return;
  try {
    const existing = await findRow("Active Leads", phone);
    if (existing > 0) {
      await updateActiveLead(phone, { status, lastMsg, name, wedding, city });
      return;
    }
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A:I",
      valueInputOption: "RAW",
      resource: {
        values: [[
          phone, name || "", wedding || "", city || "", source || "",
          status || "🆕 New Lead",
          (lastMsg || "").substring(0, 200),
          nowIST(), nowIST(),
        ]],
      },
    });
    console.log(`📊 Added to Active Leads: ${phone}`);
  } catch (err) {
    console.error("addActiveLead error:", err.message);
  }
}

async function updateActiveLead(phone, updates) {
  if (!sheetsClient) return;
  try {
    const row = await findRow("Active Leads", phone);
    if (row < 1) return;

    // Get current row
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:I${row}`,
    });
    const current = res.data.values?.[0] || ["", "", "", "", "", "", "", "", ""];

    const updated = [
      current[0] || phone,
      updates.name    || current[1] || "",
      updates.wedding || current[2] || "",
      updates.city    || current[3] || "",
      current[4] || "",
      updates.status  || current[5] || "💬 Conversation Started",
      (updates.lastMsg || current[6] || "").substring(0, 200),
      current[7] || nowIST(),
      nowIST(),
    ];

    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:I${row}`,
      valueInputOption: "RAW",
      resource: { values: [updated] },
    });
  } catch (err) {
    console.error("updateActiveLead error:", err.message);
  }
}

async function isInFollowupSent(phone) {
  if (!sheetsClient) return null;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Followup!A:H",
    });
    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0]) continue;
      const rowPhone = row[0].toString().replace(/\D/g, "");
      const matchPhone = phone.replace(/\D/g, "");
      const status = (row[5] || "").toString().toLowerCase();
      if (rowPhone.endsWith(matchPhone) && (status === "sent" || status === "pending")) {
        return {
          rowNum: i + 1,
          phone: row[0],
          name: row[1] || "",
          wedding: row[2] || "",
          city: row[3] || "",
          source: row[4] || "Followup",
        };
      }
    }
    return null;
  } catch (err) {
    console.error("isInFollowupSent error:", err.message);
    return null;
  }
}

async function markFollowupReplied(phone) {
  if (!sheetsClient) return;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Followup!A:F",
    });
    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      const rowPhone = rows[i][0].toString().replace(/\D/g, "");
      if (rowPhone.endsWith(phone.replace(/\D/g, ""))) {
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Followup!F${i + 1}`,
          valueInputOption: "RAW",
          resource: { values: [["Replied"]] },
        });
        console.log(`📊 Marked Followup as Replied: ${phone}`);
        return;
      }
    }
  } catch (err) {
    console.error("markFollowupReplied error:", err.message);
  }
}

// ── STATUS DETECTION ──────────────────────────────────────────
function detectStatus(aiReply, customerMsg) {
  const reply = (aiReply || "").toLowerCase();
  const msg   = (customerMsg || "").toLowerCase();

  if (reply.includes("garima ma'am aapko") && reply.includes("qr")) return "💳 Advance Pending";
  if (reply.includes("garima ma'am se timing confirm")) return "🏠 Studio Visit Scheduled";
  if (reply.includes("pre-bridal package — 12 services")) return "📋 Package Shared";
  if (reply.includes("why pay more")) return "💰 Price Shared";

  if (msg.includes("nahi chahiye") || msg.includes("not interested") || msg.includes("don't want")) return "❌ Not Interested";
  if (msg.includes("yes") || msg.includes("confirm") || msg.includes("book")) return "✅ Interested";

  return null; // Don't update
}

// ── META & AD TRIGGERS ────────────────────────────────────────
const META_TRIGGER  = "i filled in your form and would like to know more about your business";
const AD_DM_TRIGGER = "hello! can i get more info on this";

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
    if (key === "full_name" || key === "name")                                       d.name    = val;
    if (key === "when_is_your_wedding_date" || key === "when_is_your_wedding_date?") d.wedding = val;
    if (key === "city/area" || key === "city" || key === "area")                     d.city    = val;
  }
  return d;
}

// ── CONVERSATION MEMORY ───────────────────────────────────────
const conversations    = new Map();
const lastSentMessage  = new Map();
const adminInstructions = [];

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}
function addToHistory(phone, role, content) {
  const h = getHistory(phone);
  h.push({ role, content });
  // Trimmed to last 10 messages for cost optimization
  if (h.length > 10) h.splice(0, h.length - 10);
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a team member at Beauty Box Makeup Studio by Garima Nagpal, Vikaspuri Delhi (near Janakpuri West Metro).

You chat with brides who enquired about our Pre-Bridal package via Instagram/Facebook ads.

CRITICAL RULES:
1. MAX 1-2 lines per message. Never longer.
2. Your name is Radhya. You are a girl. Only reveal name if asked "what is your name". Never proactively.
3. You are HUMAN. If asked "are you a bot/AI": "Nahi, main Radhya hoon — Beauty Box team se."
4. Language: Mix of English, Hindi, Hinglish. First message in polite English. Then natural mix.
5. ALWAYS use "aap/aapka/aapki/aapko" — NEVER "tum/tumhara/tumhari".
6. Always end with ONE short question.
7. Use | to send multiple messages. Max 3 at a time.
8. Use emojis sparingly — max 1 per 2-3 messages.
9. Do NOT introduce yourself unless directly asked.

CONVERSATION FLOW:
Step 1: Greet by first name → ask wedding date + city
Step 2: Ask skin type
Step 3: Share 2-3 skin tips (build trust)
Step 4: Share package info naturally
Step 5: Path A (advance) or Path B (studio visit)

WHEN ASKED about services ("kya kya hoga", "services"):
Send EXACTLY:

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

WHEN ASKED about price ("kitna hai", "price"):
Send EXACTLY:

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

PATH A (ready):
"A small advance will confirm your slot. Would you like to book it now?"
If YES: "Garima ma'am aapko abhi QR code share karengi."

PATH B (hesitant):
"Aap ek baar studio visit karein — Garima ma'am personally aapki skin check karengi. Koi pressure nahi.|Kab convenient rahega aapko?"
If agrees: "Garima ma'am se timing confirm ho jaegi."

DISTANCE: NEVER bring up location proactively. Only if customer asks first.

METRO TIMES (only when asked):
- Dwarka: 15 min Pink Line
- Connaught Place: 25 min Yellow Line
- South Delhi: 35 min Yellow Line
- Shahdara: 53 min Pink Line via Pitampura
- Noida: 50 min Blue→Rajiv Chowk→Yellow

STUDIO: Vikaspuri Delhi, near Janakpuri West Metro
Maps: https://share.google/Wg5sfGr9GyYiNuzGB
Instagram: https://www.instagram.com/garimanagpalmua/

PACKAGE TIMING:
- 3+ months: skincare start now, package 30-35 days before
- 1-2 months: perfect timing, 2-3 sittings
- Within 40 days: 3 sittings possible

SKINCARE TIPS (share 2 short, based on skin type):
- Dry: Raw milk raat ko, besan+curd+haldi pack weekly
- Oily: Rose water subah, avoid fried food
- Normal: Warm water+lemon+honey subah, turmeric milk raat ko
- Hair: Coconut+castor oil hafte mein 2 baar
- Dark circles: Almond oil raat ko aankho neeche

SPECIAL RULES:
- Don't understand a message → don't react, move forward with next question
- Wedding 2+ months away → don't push for booking. Say "Abhi time hai. Aap kab free hongi baat karne ke liye?"
- Asked about bridal makeup → "Garima ma'am ka kaam yahan dekho: https://www.instagram.com/garimanagpalmua/"
- Asked about combined package (makeup + pre-bridal) → "Bilkul! Garima ma'am se directly baat karein. Kaunsa time suit karta hai call ke liye?"
- Wants to call/talk → "Aap Garima ma'am se baat kar sakti hain: +91 93542 60517"
- Price negotiation → "Garima ma'am se baat karein"
- Slot timing → "Garima ma'am confirm karengi"
- QR code → NEVER send`;

// ── SEND TEXT ─────────────────────────────────────────────────
async function sendText(toPhone, text) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    const res = await axios.post(url, { phone_number: toPhone, message_body: text, message_type: "text" });
    console.log(`✅ Sent to ${toPhone}: "${text.substring(0, 50)}"`);
    return res.data;
  } catch (err) {
    console.error(`❌ Send failed:`, err?.response?.data || err.message);
  }
}

// ── CALL CLAUDE ───────────────────────────────────────────────
async function getAIReply(phone, contextMsg) {
  addToHistory(phone, "user", contextMsg);
  const liveInstructions = adminInstructions.length > 0
    ? "\n\nLIVE INSTRUCTIONS FROM ADMIN:\n" + adminInstructions.map((ins, i) => (i+1) + ". " + ins).join("\n")
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

// ── PARSE WEBHOOK ─────────────────────────────────────────────
function parseWebhook(body) {
  try {
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (messages?.length > 0) {
      const msg = messages[0];
      const contacts = body?.entry?.[0]?.changes?.[0]?.value?.contacts || [];
      return {
        phone: msg?.from || "",
        name: contacts[0]?.profile?.name || null,
        text: msg?.text?.body || "",
        hasMedia: ["image","audio","video","document","sticker"].includes(msg?.type),
      };
    }
    const phone2 = body?.contact?.phone_number || "";
    if (phone2) {
      return {
        phone: phone2,
        name: [body?.contact?.first_name, body?.contact?.last_name].filter(Boolean).join(" ") || null,
        text: body?.message?.body || "",
        hasMedia: !!body?.message?.media?.type,
      };
    }
    return null;
  } catch (e) { return null; }
}

// ── WEBHOOK ENDPOINT ──────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const parsed = parseWebhook(req.body);
    if (!parsed?.phone) return;
    const { phone, name, text, hasMedia } = parsed;
    if (!text && !hasMedia) return;
    if (text && text.trim() === "") return;

    // Admin training number
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.endsWith("9560277217")) {
      console.log(`👨‍💼 ADMIN INSTRUCTION: "${text}"`);
      adminInstructions.push(text);
      if (adminInstructions.length > 5) adminInstructions.shift();
      await sendText(phone, `Understood. Instruction noted: "${text.substring(0, 80)}"`);
      return;
    }

    const isNewLead    = isMetaLead(text);
    const hasHistory   = conversations.has(phone) && getHistory(phone).length > 0;
    const followupData = !hasHistory && !isNewLead ? await isInFollowupSent(phone) : null;

    if (!isNewLead && !hasHistory && !followupData) {
      console.log(`⏭️ Ignored: ${phone}`);
      return;
    }

    if (hasMedia && !text) {
      await sendText(phone, "Text mein likhein please.");
      return;
    }

    let contextMsg = text;
    let leadInfo = { source: "Existing" };

    if (isNewLead) {
      if (isAdDM(text)) {
        const firstName = name ? name.split(" ")[0] : "";
        console.log(`📱 AD DM LEAD: ${firstName || "unknown"} from ${phone}`);
        leadInfo = { name: firstName, source: "Ad DM" };
        contextMsg = `New lead from Instagram/Facebook ad DM.
Customer name: ${firstName || "not given"}
They sent: "${text}"

INSTRUCTION: Follow this EXACT flow:
Step 1 — Greet warmly in polite English. Ask for marriage date ONLY. Keep it short.
After date → Step 2: Ask city/area.
After location → Step 3: Share package details.
Step 4: Ask skin type + tips.
First message: greet + ask marriage date only.
NEVER use tum/tumhara. Use aap/aapka.`;
      } else {
        const lead = extractLeadDetails(text);
        const firstName = lead.name ? lead.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
        console.log(`🎯 META FORM LEAD: ${lead.name} | ${lead.wedding} | ${lead.city}`);
        leadInfo = { name: firstName, wedding: lead.wedding, city: lead.city, source: "Meta Form" };

        const hasDate = lead.wedding && lead.wedding.toLowerCase() !== "not mentioned";
        const hasCity = lead.city && lead.city.toLowerCase() !== "not mentioned";

        let instruction = "";
        if (hasDate && hasCity) instruction = `Customer details: wedding "${lead.wedding}", from "${lead.city}". Greet by first name in polite English, mention you received their enquiry, then share complete services list and ask if they have questions.`;
        else if (hasDate) instruction = `Wedding "${lead.wedding}" known, city not. Greet by first name, share services list, ask which city/area.`;
        else if (hasCity) instruction = `From "${lead.city}" but no date. Greet by first name, ask wedding date and area of ${lead.city}.`;
        else instruction = `No date or city. Greet by first name in polite English, ask wedding date and location.`;

        contextMsg = `New lead from Meta ad form:
Name: ${firstName || "not given"}
Wedding: ${lead.wedding || "not mentioned"}
City: ${lead.city || "not mentioned"}
${instruction}
IMPORTANT: Polite English first message. NEVER use tum/tumhara.`;
      }
    } else if (followupData) {
      // First reply from Followup sheet
      const firstName = followupData.name ? followupData.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
      console.log(`📤 FOLLOWUP REPLY: ${firstName} (${phone})`);
      leadInfo = {
        name: firstName,
        wedding: followupData.wedding,
        city: followupData.city,
        source: "Followup",
      };
      await markFollowupReplied(phone);
      contextMsg = `Customer replied to our outreach template: "${text}"
Name: ${firstName || "not given"}
Wedding: ${followupData.wedding || "not mentioned"}
City: ${followupData.city || "not mentioned"}

INSTRUCTION: Greet warmly${firstName ? " as " + firstName : ""} in polite English. Ask wedding date${followupData.wedding ? "" : ""} and area. Do NOT introduce yourself or mention brochure.`;
    }

    // Add/Update Active Leads sheet BEFORE AI replies
    if (isNewLead || followupData) {
      await addActiveLead(phone, leadInfo.name, leadInfo.wedding, leadInfo.city, leadInfo.source, "🆕 New Lead", text);
    }

    // Get AI reply
    const reply = await getAIReply(phone, contextMsg);
    const parts = reply.split("|").map(p => p.trim()).filter(Boolean).slice(0, 3);

    // 5-6 second delay
    await new Promise(r => setTimeout(r, 5500));

    const lastSent = lastSentMessage.get(phone) || "";
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === lastSent && i === 0) continue;
      if (i > 0) await new Promise(r => setTimeout(r, 1800));
      await sendText(phone, parts[i]);
      lastSentMessage.set(phone, parts[i]);
    }

    // Update sheet with status after reply
    const status = detectStatus(reply, text);
    await updateActiveLead(phone, { lastMsg: text, status });

  } catch (err) {
    console.error("❌ Webhook error:", err?.response?.data || err.message);
  }
});

// ── ADMIN PANEL ───────────────────────────────────────────────
app.get("/admin", (req, res) => {
  const defaultMsg = `We have received your inquiry on our advertisement for Pre-Bridal Package. Please let us know your marriage date and location.\n\nRegards,\nBeauty Box Makeup Studio by Garima Nagpal`;
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beauty Box Admin</title>
<style>*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,sans-serif}body{background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px}.card{background:#fff;border-radius:16px;padding:28px 24px;width:100%;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,0.1)}h2{font-size:18px;font-weight:600;color:#111;margin-bottom:4px}p{font-size:13px;color:#888;margin-bottom:16px}label{font-size:13px;color:#444;display:block;margin:12px 0 5px;font-weight:500}input{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none}input:focus{border-color:#128C7E}textarea{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none;resize:vertical;min-height:100px;line-height:1.6;font-family:-apple-system,sans-serif}textarea:focus{border-color:#128C7E}.hint{font-size:11px;color:#aaa;margin-top:4px}.msg{margin-top:14px;padding:11px;border-radius:10px;font-size:14px;text-align:center;display:none}.ok{background:#e8f5e9;color:#2e7d32}.err{background:#fdecea;color:#c62828}small{display:block;font-size:12px;color:#aaa;text-align:center;margin-top:12px;line-height:1.5}</style></head><body><div class="card"><h2>Beauty Box</h2><p>Send opening message and start bot</p><label>Phone number (with country code, no +)</label><input id="ph" type="tel" placeholder="919999999999"><label>Customer name (optional)</label><input id="nm" type="text" placeholder="Priya"><label>Opening message <span style="font-weight:400;color:#aaa">(editable)</span></label><textarea id="omsg">${defaultMsg}</textarea><div class="hint">Edit before sending. Bot takes over after customer replies.</div><label>Admin key</label><input id="ky" type="password" placeholder="Enter admin key"><div style="display:flex;gap:10px;margin-top:18px"><button onclick="go(true)" style="flex:1;background:#128C7E;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:500;cursor:pointer">Send Message &amp; Activate Bot</button><button onclick="go(false)" style="flex:1;background:#555;color:#fff;border:none;border-radius:10px;padding:11px;font-size:13px;cursor:pointer">Activate Bot Only<br><span style="font-size:11px;opacity:0.8">(message sent manually)</span></button></div><div class="msg" id="msg"></div><small>Bot handles all replies automatically.</small></div><script>async function go(sendMsg){const ph=document.getElementById('ph').value.trim();const nm=document.getElementById('nm').value.trim();const ky=document.getElementById('ky').value.trim();const om=document.getElementById('omsg').value.trim();if(!ph||!ky){sh('Enter phone and admin key','err');return;}try{const r=await fetch('/admin/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,name:nm,key:ky,openingMessage:sendMsg?om:'',sendMessage:sendMsg})});const d=await r.json();if(d.success){sh(sendMsg?'Sent to '+ph+'. Bot activated!':'Bot activated for '+ph,'ok');document.getElementById('ph').value='';document.getElementById('nm').value='';}else sh(d.error||'Error','err');}catch(e){sh('Network error','err');}}function sh(t,c){const el=document.getElementById('msg');el.textContent=t;el.className='msg '+c;el.style.display='block';}document.getElementById('ky').addEventListener('keydown',e=>{if(e.key==='Enter')go(true);});</script></body></html>`);
});

app.post("/admin/start", async (req, res) => {
  const { phone, name, key } = req.body;
  if (key !== ADMIN_KEY) return res.json({ success: false, error: "Wrong admin key" });
  if (!phone) return res.json({ success: false, error: "Phone number required" });
  try {
    const sendMsg = req.body.sendMessage !== false;
    const firstName = name ? name.trim().split(" ")[0] : "";

    if (sendMsg && req.body.openingMessage) {
      const openingMsg = req.body.openingMessage.trim();
      await new Promise(r => setTimeout(r, 1000));
      await sendText(phone, openingMsg);
      addToHistory(phone, "assistant", openingMsg);
      await addActiveLead(phone, firstName, "", "", "Admin Initiated", "💬 Conversation Started", openingMsg);
      console.log(`🚀 ADMIN: Message sent for ${phone}`);
    } else {
      conversations.set(phone, []);
      addToHistory(phone, "assistant", "Admin activated this number.");
      await addActiveLead(phone, firstName, "", "", "Admin Activated", "🆕 New Lead", "Manually activated");
      console.log(`📋 ADMIN: Activated ${phone}`);
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    agent: "Beauty Box AI Agent v2",
    claude: ANTHROPIC_API_KEY ? "OK" : "MISSING",
    wapi: WAPI_VENDOR_UID ? "OK" : "MISSING",
    sheets: sheetsClient ? "OK" : "DISABLED",
    admin: "/admin",
  });
});

// ── DAILY STATUS REPORT ───────────────────────────────────────
async function sendDailyReport() {
  try {
    if (!sheetsClient) return;
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A:I",
    });
    const rows = res.data.values || [];
    const total = Math.max(0, rows.length - 1);
    let today = 0;
    const todayStr = new Date().toLocaleDateString("en-IN");
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][7] && rows[i][7].includes(todayStr.split("/")[0])) today++;
    }
    await sendText(ADMIN_PHONE, `🌅 Beauty Box Daily Report\n\n✅ Bot is running fine\n📊 Total leads: ${total}\n📅 New today: ${today}\n\nCheck /admin for details.`);
  } catch (err) {
    console.error("Daily report error:", err.message);
  }
}

// Schedule daily report at 9 AM IST
function scheduleDailyReport() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const next9am = new Date(istNow);
  next9am.setHours(9, 0, 0, 0);
  if (istNow >= next9am) next9am.setDate(next9am.getDate() + 1);
  const delay = next9am - istNow;
  setTimeout(() => {
    sendDailyReport();
    setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
  }, delay);
  console.log(`📅 Daily report scheduled in ${Math.round(delay/1000/60)} minutes`);
}

// ── STARTUP ───────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 Beauty Box Agent v2 on port ${PORT}`);
  console.log(`🔑 Claude:  ${ANTHROPIC_API_KEY ? "OK" : "MISSING"}`);
  console.log(`📱 WAPI:    ${WAPI_VENDOR_UID ? "OK" : "MISSING"}`);
  console.log(`🔐 Token:   ${WAPI_TOKEN ? "OK" : "MISSING"}`);
  console.log(`📊 Sheet ID: ${SHEET_ID ? "OK" : "MISSING"}`);
  console.log(`🔒 Admin:   /admin (key: ${ADMIN_KEY})`);
  await initSheets();
  scheduleDailyReport();
  console.log(`✅ All systems ready\n`);
});
