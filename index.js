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
const BOT_ACTIVE        = true;
const SHEET_ID          = process.env.SHEET_ID          || "";
const ADMIN_PHONE       = "919560277217";
const GARIMA_PHONE      = "919354260517";

// PDF URL - Only Pre-Bridal PDF will be sent
const PREBRIDAL_PDF_URL = process.env.PREBRIDAL_PDF_URL || "https://raw.githubusercontent.com/gauravnagpal1711-hue/bb-assets/main/Prebridal_7499.pdf";

let sheetsClient = null;
async function initSheets() {
  try {
    if (!process.env.GOOGLE_CREDENTIALS || !SHEET_ID) {
      console.log("Sheets disabled -- credentials or SHEET_ID missing");
      return;
    }
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth  = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    console.log("Google Sheets connected");
    await ensureHeaders();
  } catch (err) {
    console.error("Sheets init failed:", err.message);
  }
}

async function ensureHeaders() {
  try {
    const activeHeaders = ["Phone", "Name", "Wedding Date", "City/Area", "Source", "Status", "Last Message", "First Seen", "Last Updated", "Service Path", "Bot Intervention"];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A1:K1",
      valueInputOption: "RAW",
      resource: { values: [activeHeaders] },
    });
    const followupHeaders = ["Phone", "Name", "Wedding Date", "City/Area", "Source", "Template Sent", "Sent Date", "Notes"];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "Followup!A1:H1",
      valueInputOption: "RAW",
      resource: { values: [followupHeaders] },
    });
    console.log("Sheet headers verified");
  } catch (err) {
    console.log("Header setup skipped:", err.message);
  }
}

async function getCustomerData(phone) {
  if (!sheetsClient) return null;
  try {
    const row = await findRow("Active Leads", phone);
    if (row < 1) return null;
    
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:K${row}`,
    });
    const current = res.data.values?.[0];
    if (!current) return null;
    
    return {
      phone: current[0] || "",
      name: current[1] || "",
      wedding: current[2] || "",
      city: current[3] || "",
      source: current[4] || "",
      status: current[5] || "",
      lastMessage: current[6] || "",
      servicePath: current[9] || "",
      botIntervention: current[10] !== undefined ? current[10] : "Yes",
    };
  } catch (err) {
    console.error("getCustomerData error:", err.message);
    return null;
  }
}

// CRITICAL: Check Bot Intervention column K BEFORE every reply
async function checkBotIntervention(phone) {
  if (!sheetsClient) {
    console.log(`Sheets not connected - bot defaults to ON for ${phone}`);
    return true;
  }
  try {
    const row = await findRow("Active Leads", phone);
    if (row < 1) {
      console.log(`No row found for ${phone} - new lead, bot defaults to ON`);
      return true;
    }
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!K${row}`,
    });
    const val = res.data.values?.[0]?.[0] || "Yes";
    const cleanVal = val.toString().trim().toLowerCase();
    const isOn = cleanVal === "yes" || cleanVal === "y" || cleanVal === "";
    
    if (!isOn) {
      console.log(`Bot Intervention = "${val}" for ${phone} -- BOT SKIPPING REPLY`);
    } else {
      console.log(`Bot Intervention = "${val}" for ${phone} -- BOT REPLYING`);
    }
    return isOn;
  } catch (err) {
    console.error("checkBotIntervention error:", err.message);
    return true;
  }
}

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
      range: "Active Leads!A:K",
      valueInputOption: "RAW",
      resource: {
        values: [[
          phone, name || "", wedding || "", city || "", source || "",
          status || "New Lead",
          (lastMsg || "").substring(0, 200),
          nowIST(), nowIST(),
          "",
          "Yes",
        ]],
      },
    });
    console.log(`Added to Active Leads: ${phone}`);
  } catch (err) {
    console.error("addActiveLead error:", err.message);
  }
}

async function updateActiveLead(phone, updates) {
  if (!sheetsClient) return;
  try {
    const row = await findRow("Active Leads", phone);
    if (row < 1) return;
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:K${row}`,
    });
    const current = res.data.values?.[0] || ["", "", "", "", "", "", "", "", "", "", "Yes"];
    const updated = [
      current[0] || phone,
      updates.name    || current[1] || "",
      updates.wedding || current[2] || "",
      updates.city    || current[3] || "",
      current[4] || "",
      updates.status  || current[5] || "Conversation Started",
      (updates.lastMsg || current[6] || "").substring(0, 200),
      current[7] || nowIST(),
      nowIST(),
      updates.servicePath || current[9] || "",
      current[10] !== undefined ? current[10] : "Yes",
    ];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:K${row}`,
      valueInputOption: "RAW",
      resource: { values: [updated] },
    });
  } catch (err) {
    console.error("updateActiveLead error:", err.message);
  }
}

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
    if (key === "full_name" || key === "name") d.name = val;
    if (key === "when_is_your_wedding_date" || key === "when_is_your_wedding_date?") d.wedding = val;
    if (key === "city/area" || key === "city" || key === "area") d.city = val;
  }
  return d;
}

const conversations      = new Map();
const lastSentMessage    = new Map();
const lastMessageTime    = new Map();
const nudgeSent          = new Map();
const pendingMenuSelect  = new Set();
const customerPath       = new Map();

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}

function addToHistory(phone, role, content) {
  const h = getHistory(phone);
  h.push({ role, content });
  if (h.length > 10) h.splice(0, h.length - 10);
}

const MENU_TEXT_FALLBACK = `Welcome to Beauty Box Makeup Studio

Aap kaunsi service ke baare mein jaanna chahti hain?

*A* -- Pre-Bridal Package
*B* -- Pre Bridal+ Bridal Makeup Combo
*C* -- Hydra Facial Package
*D* -- Nail Services
*E* -- Other Beauty Services

Reply A, B, C, D ya E karein`;

async function sendMenuButtons(toPhone) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    const payload = {
      phone_number: toPhone,
      message_type: "text",
      message_body: MENU_TEXT_FALLBACK,
    };
    await axios.post(url, payload);
    console.log(`Menu sent to ${toPhone}`);
  } catch (err) {
    console.error(`Menu failed:`, err?.response?.data?.message || err.message);
  }
}

function detectMenuSelection(text) {
  const t = (text || "").trim().toUpperCase();
  if (t === "A" || t === "1") return "A";
  if (t === "B" || t === "2") return "B";
  if (t === "C" || t === "3") return "C";
  if (t === "D" || t === "4") return "D";
  if (t === "E" || t === "5") return "E";
  return null;
}

// SERVICE RESPONSES - All as text messages
function getServiceResponse(selection, customerName) {
  const name = customerName ? `${customerName}, ` : "";
  
  switch(selection) {
    case "A":
      return `${name}*PRE-BRIDAL PACKAGE - Rs.7,499* (Market Value Rs.16,800 - Save Rs.12,001 / 71% OFF)

*12 Services in 3 Sittings:*

*1st Sitting - Skin Prep & Brightening:*
- O3+ Facial
- Bleach / D-Tan

*2nd Sitting - Body Glow & Hair Nourish:*
- Full Body Bleach
- Manicure
- Pedicure
- Loreal Hair Spa

*3rd Sitting - Final Bridal Finish:*
- Full Body Wax
- Full Body Polishing
- Nail Extension
- Face Bleach & O3+ Facial
- Threading & Upper Lips

Premium Products | Hygienic & Safe Care | Flexible Appointments | Expert Professionals

Kab convenient hoga aapko studio visit ke liye?
Garima ma'am: +91 93542 60517`;
    
    case "B":
      return `${name}*PRE-BRIDAL + BRIDAL MAKEUP COMBO - Rs.16,500* (Save Rs.1,999)

*Includes:*
- Complete Pre-Bridal Package (12 services in 3 sittings)
- Bridal Makeup

*Bridal Makeup includes:*
- Waterproof & Long-Lasting finish
- Full Coverage Soft Glam Velvety Matte
- Lashes & Lenses
- Draping + Hairstyle (Complimentary)

Kab convenient hoga aapko?
Garima ma'am: +91 93542 60517`;
    
    case "C":
      return `${name}*HYDRA FACIAL PACKAGE*

*Single Sitting:* Rs.1,199
*3-Sitting Package:* Rs.2,999 (Recommended - Best Value)

*Benefits:*
- Deep hydration
- Brightening & glow
- Skin barrier restore
- 60-70% improvement typical
- 2-3 weeks apart for best results

Kab convenient hoga aapko?
Garima ma'am: +91 93542 60517`;
    
    case "D":
      return `${name}*NAIL SERVICES*

- Nail Extension: Rs.599 onwards
- Natural Nail: Rs.349 onwards
- Acrylic Nails: Rs.699 onwards
- Gel Nail Extension: Rs.899 onwards

*Pedicure Services:*
- Classic Pedicure: Rs.399
- Spa Pedicure: Rs.449
- French Pedicure: Rs.549
- Gel Pedicure: Rs.749
- Korean Pedicure: Rs.899

Professional team handles all services. Kab convenient hoga aapko?
Garima ma'am: +91 93542 60517`;
    
    case "E":
      return `${name}*BEAUTY BOX COMPLETE PRICE LIST*

*FACIALS:*
- Classic Facial (Fruit): Rs.549
- Dr. Rashel DE Tan: Rs.499
- Lotus Natural Glow: Rs.799
- Biotique Anti Ageing: Rs.849
- Whiting Facial: Rs.999
- Lotus Hydra Facial: Rs.999
- Oxylife Pro: Rs.999
- Red Wine Facial: Rs.1,399
- Korean Facial: Rs.1,999
- Premium Facial: Rs.1,599
- O3+ Vitamin Power Brightening: Rs.1,999
- O3+ Vitamin Bridal Glow: Rs.2,199

*HAIR CARE:*
- Classic Hair Spa: Rs.499
- Loreal Hair Spa: Rs.799
- Hair Trimming: Rs.149
- Blow Dryer: Rs.249
- Hair Cut: Rs.249
- Root Touchup: Rs.649
- Full Length Hair Color: Rs.1,499
- Nanoplastia: Rs.2,499
- Keratin: Rs.1,499
- Global Color: Rs.2,499
- Global with Pre-lights: Rs.3,999

*CLEANUPS:*
- Fruit: Rs.349
- Red Wine: Rs.649
- Whiting Glow: Rs.549
- Oxy Professional: Rs.549
- D-Tan: Rs.599

*WAXING:*
- Brazilian Face Wax: Rs.299
- Honey Full Arms + Underarms: Rs.199
- Honey Full Legs: Rs.299
- Honey Full Body: Rs.1,199
- White Choco Full Arms + Underarms: Rs.299
- White Choco Full Legs: Rs.399
- White Choco Full Body: Rs.1,499
- Rica Full Arms + Underarms: Rs.399
- Rica Full Legs: Rs.599
- Rica Full Body Wax: Rs.1,999

*BASIC CARING:*
- Arms Polishing: Rs.349
- Full Body Polishing: Rs.1,999
- Manicure: Rs.349
- Threading: Rs.30
- Upperlips: Rs.20
- Upperlips (Wax): Rs.50
- Chin Wax: Rs.50
- Head Massage: Rs.249

*BLEACH:*
- Herbal Bleach: Rs.249
- Back Bleach: Rs.299
- Full Arms Bleach: Rs.299
- Oxylife Bleach: Rs.349
- D-Tan Bleach: Rs.349
- Full Body Bleach: Rs.1,999

*PARTY MAKE-UPS:*
- HD Makeup: Rs.1,999
- Sillicon HD Makeup: Rs.2,999

Kaunsi service chahiye aapko?
Garima ma'am: +91 93542 60517`;
    
    default:
      return "Aap service select karein. A, B, C, D ya E reply karein.";
  }
}

// Send PDF document via WAPI - Only for Pre-Bridal
async function sendPDF(toPhone, pdfUrl, caption) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    const payload = {
      phone_number: toPhone,
      message_type: "media",
      media: {
        url: pdfUrl,
        type: "document",
        caption: caption || ""
      }
    };
    const res = await axios.post(url, payload);
    console.log(`PDF sent to ${toPhone}: ${pdfUrl}`);
    return res.data;
  } catch (err) {
    console.error(`PDF send failed to ${toPhone}:`, err?.response?.data || err.message);
    // Fallback: send as text link
    await sendText(toPhone, `Aap yeh PDF download kar sakte hain: ${pdfUrl}`);
  }
}

async function sendText(toPhone, text) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    const res = await axios.post(url, { phone_number: toPhone, message_body: text, message_type: "text" });
    console.log(`Sent to ${toPhone}: "${text.substring(0, 50)}"`);
    return res.data;
  } catch (err) {
    console.error(`Send failed:`, err?.response?.data || err.message);
  }
}

function parseWebhook(body) {
  try {
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (messages?.length > 0) {
      const msg = messages[0];
      const contacts = body?.entry?.[0]?.changes?.[0]?.value?.contacts || [];
      const phone = msg?.from || "";
      const name = contacts[0]?.profile?.name || null;

      if (msg?.type === "interactive") {
        const interactive = msg.interactive;
        const selectedId    = interactive?.list_reply?.id    || interactive?.button_reply?.id    || "";
        const selectedTitle = interactive?.list_reply?.title || interactive?.button_reply?.title || "";
        return {
          phone,
          name,
          text: selectedId || selectedTitle,
          hasMedia: false,
          isInteractive: true,
          interactiveId: selectedId.toUpperCase(),
        };
      }

      return {
        phone,
        name,
        text: msg?.text?.body || "",
        hasMedia: ["image","audio","video","document","sticker"].includes(msg?.type),
        isInteractive: false,
      };
    }

    const phone2 = body?.contact?.phone_number || "";
    if (phone2) {
      return {
        phone: phone2,
        name: [body?.contact?.first_name, body?.contact?.last_name].filter(Boolean).join(" ") || null,
        text: body?.message?.body || "",
        hasMedia: !!body?.message?.media?.type,
        isInteractive: false,
      };
    }
    return null;
  } catch (e) { return null; }
}

app.post("/webhook", async (req, res) => {
  try {
    const parsed = parseWebhook(req.body);
    if (!parsed?.phone) return res.sendStatus(200);
    const { phone, name, text, hasMedia, isInteractive, interactiveId } = parsed;
    if (!text && !hasMedia) return res.sendStatus(200);
    if (text && text.trim() === "") return res.sendStatus(200);

    console.log(`\n[${new Date().toLocaleTimeString()}] Message from ${phone}: "${text.substring(0, 80)}"`);

    // Skip admin messages
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.endsWith("9560277217")) {
      console.log(`Admin message - skipping`);
      return res.sendStatus(200);
    }

    const isNewLead  = isMetaLead(text);
    const hasHistory = conversations.has(phone) && getHistory(phone).length > 0;

    // STEP 1: Add ALL leads to Google Sheets immediately
    if (!hasHistory) {
      const lead = isNewLead ? extractLeadDetails(text) : {};
      const firstName = lead.name ? lead.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
      const source = isAdDM(text) ? "Ad DM" : (isNewLead ? "Meta Form" : "Direct Message");
      await addActiveLead(phone, firstName, lead.wedding || "", lead.city || "", source, "New Lead", text);
      console.log(`ADDED TO SHEETS: ${phone} | Source: ${source}`);
    } else {
      await updateActiveLead(phone, { lastMsg: text });
    }

    // STEP 2: Check global BOT_ACTIVE flag
    if (!BOT_ACTIVE) {
      console.log(`BOT_ACTIVE=false -- Lead recorded, no reply: ${phone}`);
      return res.sendStatus(200);
    }

    // STEP 3: CRITICAL - Check Google Sheet "Bot Intervention" column K
    const botCanReply = await checkBotIntervention(phone);
    if (!botCanReply) {
      console.log(`Bot Intervention = NO for ${phone} - SKIPPING REPLY`);
      return res.sendStatus(200);
    }

    if (hasMedia && !text) {
      await sendText(phone, "Text mein likhein please.");
      return res.sendStatus(200);
    }

    lastMessageTime.set(phone, Date.now());
    nudgeSent.set(phone, false);

    // STEP 4: NEW LEAD - Send menu
    if (!hasHistory && (isNewLead || text.toLowerCase().includes("info") || text.toLowerCase().includes("hello"))) {
      console.log(`NEW LEAD - sending menu to ${phone}`);
      await new Promise(r => setTimeout(r, 2000));
      await sendMenuButtons(phone);
      pendingMenuSelect.add(phone);
      conversations.set(phone, []);
      addToHistory(phone, "assistant", MENU_TEXT_FALLBACK);
      return res.sendStatus(200);
    }

    // STEP 5: MENU SELECTION - Send service details
    if (pendingMenuSelect.has(phone)) {
      const selection = isInteractive
        ? (interactiveId || "")
        : detectMenuSelection(text);

      if (selection && ["A","B","C","D","E"].includes(selection)) {
        console.log(`PATH ${selection} SELECTED: ${phone}`);
        pendingMenuSelect.delete(phone);
        customerPath.set(phone, selection);

        const customerName = name ? name.split(" ")[0] : "";
        const response = getServiceResponse(selection, customerName);

        const pathLabels = {
          "A": "Pre-Bridal Package",
          "B": "Pre Bridal+ Bridal Makeup Combo",
          "C": "Hydra Facial Package",
          "D": "Nail Services",
          "E": "Other Beauty Services",
        };
        await updateActiveLead(phone, {
          status: `Selected: ${selection}`,
          servicePath: pathLabels[selection],
        });

        // Send text response
        await new Promise(r => setTimeout(r, 2000));
        await sendText(phone, response);
        lastSentMessage.set(phone, response);

        // Send PDF ONLY for Path A (Pre-Bridal) and Path B (Combo includes Pre-Bridal)
        if (selection === "A" || selection === "B") {
          await new Promise(r => setTimeout(r, 3000));
          await sendPDF(phone, PREBRIDAL_PDF_URL, "Pre-Bridal Package Details");
          console.log(`Pre-Bridal PDF sent to ${phone} for path ${selection}`);
        }
        
        return res.sendStatus(200);
      } else {
        await sendText(phone, "Aap A, B, C, D ya E reply karein");
        return res.sendStatus(200);
      }
    }

    // STEP 6: Continuing conversation
    if (hasHistory) {
      console.log(`Continuing conversation with ${phone}`);
      addToHistory(phone, "user", text);
      
      await new Promise(r => setTimeout(r, 2000));
      const response = `Garima ma'am aapko confirm karengi.
+91 93542 60517

Aap unhe directly call ya WhatsApp kar sakte hain.`;
      await sendText(phone, response);
      addToHistory(phone, "assistant", response);
      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err?.response?.data || err.message);
    res.sendStatus(200);
  }
});

app.get("/admin", (req, res) => {
  const defaultMsg = `We have received your inquiry on our advertisement for Pre-Bridal Package. Please let us know your marriage date and location.\n\nRegards,\nBeauty Box Makeup Studio by Garima Nagpal`;
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beauty Box Admin v3.1</title>
<style>*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,sans-serif}body{background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px}.container{display:flex;gap:16px;width:100%;max-width:900px;flex-wrap:wrap}.card{background:#fff;border-radius:16px;padding:28px 24px;flex:1;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.1)}h2{font-size:18px;font-weight:600;color:#111;margin-bottom:4px}p{font-size:13px;color:#888;margin-bottom:16px}label{font-size:13px;color:#444;display:block;margin:12px 0 5px;font-weight:500}input{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none;margin-bottom:8px}textarea{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none;resize:vertical;min-height:100px;line-height:1.6;font-family:-apple-system,sans-serif}.msg{margin-top:14px;padding:11px;border-radius:10px;font-size:14px;text-align:center;display:none}.ok{background:#e8f5e9;color:#2e7d32}.err{background:#fdecea;color:#c62828}button{width:100%;background:#128C7E;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:500;cursor:pointer;margin-top:10px}button:hover{background:#0d6b65}</style></head><body><div class="container"><div class="card"><h2>Beauty Box Admin v3.1</h2><p>Send opening message and activate bot</p><label>Phone (with country code)</label><input id="ph" type="tel" placeholder="919999999999"><label>Name</label><input id="nm" type="text" placeholder="Priya"><label>Opening message</label><textarea id="omsg">${defaultMsg}</textarea><label>Admin key</label><input id="ky" type="password" placeholder="beautybox2024"><button onclick="goNew()">Send & Activate Bot</button><div class="msg" id="msg1"></div></div></div><script>async function goNew(){const ph=document.getElementById('ph').value.trim();const ky=document.getElementById('ky').value.trim();if(!ph||!ky){sh('Enter phone and key','err','msg1');return;}try{const r=await fetch('/admin/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,name:document.getElementById('nm').value.trim(),key:ky,openingMessage:document.getElementById('omsg').value.trim()})});const d=await r.json();if(d.success){sh('Bot activated for '+ph,'ok','msg1');}else sh(d.error||'Error','err','msg1');}catch(e){sh('Network error','err','msg1');}}function sh(t,c,id){const el=document.getElementById(id);el.textContent=t;el.className='msg '+c;el.style.display='block';}</script></body></html>`);
});

app.post("/admin/start", async (req, res) => {
  const { phone, name, key, openingMessage } = req.body;
  if (key !== ADMIN_KEY) return res.json({ success: false, error: "Wrong admin key" });
  if (!phone) return res.json({ success: false, error: "Phone required" });
  try {
    const firstName = name ? name.trim().split(" ")[0] : "";
    if (openingMessage) {
      await sendText(phone, openingMessage.trim());
      await addActiveLead(phone, firstName, "", "", "Admin Initiated", "Conversation Started", openingMessage);
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get("/", (req, res) => {
  res.json({
    agent: "Beauty Box AI Agent v3.1",
    bot_active: BOT_ACTIVE,
    bot_intervention_check: "ENABLED - Checks Google Sheet column K before every reply",
    pre_bridal_pdf: PREBRIDAL_PDF_URL,
    claude: ANTHROPIC_API_KEY ? "OK" : "MISSING",
    wapi: WAPI_VENDOR_UID ? "OK" : "MISSING",
    sheets: sheetsClient ? "OK" : "DISABLED",
    activeConversations: conversations.size,
  });
});

app.listen(PORT, async () => {
  console.log(`\n=== BEAUTY BOX BOT v3.1 ===`);
  console.log(`Port: ${PORT}`);
  console.log(`BOT_ACTIVE: ${BOT_ACTIVE}`);
  console.log(`Bot Intervention Check: ENABLED (checks column K before every reply)`);
  console.log(`\nPDF Configuration:`);
  console.log(`Pre-Bridal PDF: ${PREBRIDAL_PDF_URL}`);
  console.log(`(Other services sent as text only)`);
  console.log(`\nAPI Status:`);
  console.log(`Claude: ${ANTHROPIC_API_KEY ? "OK" : "MISSING"}`);
  console.log(`WAPI: ${WAPI_VENDOR_UID ? "OK" : "MISSING"}`);
  console.log(`Sheet: ${SHEET_ID ? "OK" : "MISSING"}`);
  
  await initSheets();
  
  console.log(`\n=== v3.1 FEATURES ===`);
  console.log(`Path A (Pre-Bridal) -- Text + PDF`);
  console.log(`Path B (Combo) -- Text + Pre-Bridal PDF`);
  console.log(`Path C (Hydra) -- Text only`);
  console.log(`Path D (Nails) -- Text only`);
  console.log(`Path E (Other) -- Text only`);
  console.log(`\nAll systems ready\n`);
});
