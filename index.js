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

// PDF URL - Short URL from Railway environment variable
const PREBRIDAL_PDF_URL = process.env.PREBRIDAL_PDF_URL || "https://bit.ly/4fbKIox";

let sheetsClient = null;
async function initSheets() {
  try {
    if (!process.env.GOOGLE_CREDENTIALS || !SHEET_ID) {
      console.log("⚠️  Sheets disabled -- credentials or SHEET_ID missing");
      return;
    }
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth  = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    console.log("✅ Google Sheets connected");
    await ensureHeaders();
  } catch (err) {
    console.error("❌ Sheets init failed:", err.message);
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
    console.log("✅ Sheet headers verified");
  } catch (err) {
    console.log("⚠️  Header setup skipped:", err.message);
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
    console.error("❌ findRow error:", err.message);
    return -1;
  }
}

async function addActiveLead(phone, name, wedding, city, source, status, lastMsg) {
  if (!sheetsClient) {
    console.log("⚠️  Sheets not connected - skipping add lead");
    return;
  }
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
    console.log(`✅ Added to Sheets: ${phone} | Source: ${source}`);
  } catch (err) {
    console.error("❌ addActiveLead error:", err.message);
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
    console.error("❌ updateActiveLead error:", err.message);
  }
}

// EXACT TRIGGER - Only this message
const EXACT_TRIGGER = "Hello! Can I get more info on this?";

function isExactTrigger(text) {
  const lower = (text || "").trim().toLowerCase();
  return lower === EXACT_TRIGGER.toLowerCase();
}

// Check if bot already sent contact message
async function hasContactMessageSent(phone) {
  if (!sheetsClient) return false;
  try {
    const row = await findRow("Active Leads", phone);
    if (row < 1) return false;
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:K${row}`,
    });
    const status = res.data.values?.[0]?.[5] || "";
    return status.toLowerCase().includes("booking inquiry") || status.toLowerCase().includes("contact sent");
  } catch (err) {
    return false;
  }
}

// Detect booking intent
function detectBookingIntent(text) {
  const lower = text.toLowerCase().trim();
  const bookingKeywords = [
    "book", "booking", "slot", "date", "time", "available", "kab",
    "when", "schedule", "confirm", "call", "number", "contact",
    "whatsapp", "garima", "appointment", "meeting",
    "convenient", "ready", "book karna", "slot de do", "kab aa sakte",
    "kab aa sakta", "kitna paisa", "price", "cost", "kitne mein",
    "discount", "offer", "badhiya hai", "theek hai", "mujhe book kar do"
  ];
  
  for (const keyword of bookingKeywords) {
    if (lower.includes(keyword)) return true;
  }
  return false;
}

// Check Bot Intervention column K
async function checkBotIntervention(phone) {
  if (!sheetsClient) {
    console.log(`ℹ️  Sheets not connected - bot defaults to ON for ${phone}`);
    return true;
  }
  try {
    const row = await findRow("Active Leads", phone);
    if (row < 1) {
      console.log(`ℹ️  No row found for ${phone} - bot defaults to ON`);
      return true;
    }
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!K${row}`,
    });
    const val = res.data.values?.[0]?.[0] || "Yes";
    const cleanVal = val.toString().trim().toLowerCase();
    const isOn = cleanVal === "yes" || cleanVal === "y" || cleanVal === "";
    
    console.log(`🔍 Bot Intervention for ${phone}: "${val}" → ${isOn ? "✅ ON" : "❌ OFF"}`);
    return isOn;
  } catch (err) {
    console.error("❌ checkBotIntervention error:", err.message);
    return true;
  }
}

const conversations      = new Map();
const lastSentMessage    = new Map();
const lastMessageTime    = new Map();
const pendingMenuSelect  = new Set();
const customerPath       = new Map();
const contactMessageSent = new Map();

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}

function addToHistory(phone, role, content) {
  const h = getHistory(phone);
  h.push({ role, content });
  if (h.length > 10) h.splice(0, h.length - 10);
}

const MENU_TEXT = `Welcome to Beauty Box Makeup Studio 💄

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
      message_body: MENU_TEXT,
    };
    await axios.post(url, payload);
    console.log(`✅ Menu sent to ${toPhone}`);
  } catch (err) {
    console.error(`❌ Menu failed:`, err?.response?.data?.message || err.message);
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

Premium Products | Hygienic & Safe Care | Flexible Appointments`;
    
    case "B":
      return `${name}*PRE-BRIDAL + BRIDAL MAKEUP COMBO - Rs.16,500* (Save Rs.1,999)

*Includes:*
- Complete Pre-Bridal Package (12 services in 3 sittings)
- Bridal Makeup

*Bridal Makeup includes:*
- Waterproof & Long-Lasting finish
- Full Coverage Soft Glam Velvety Matte
- Lashes & Lenses
- Draping + Hairstyle (Complimentary)`;
    
    case "C":
      return `${name}*HYDRA FACIAL PACKAGE*

*Single Sitting:* Rs.1,199
*3-Sitting Package:* Rs.2,999 (Recommended - Best Value)

*Benefits:*
- Deep hydration
- Brightening & glow
- Skin barrier restore
- 60-70% improvement typical
- 2-3 weeks apart for best results`;
    
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

Professional team handles all services.`;
    
    case "E":
      return `${name}*BEAUTY BOX COMPLETE PRICE LIST*

*FACIALS:* Classic (Rs.549) | DE Tan (Rs.499) | Lotus (Rs.799) | Biotique (Rs.849) | Whiting (Rs.999) | Hydra (Rs.999) | Oxylife (Rs.999) | Red Wine (Rs.1,399) | Korean (Rs.1,999) | Premium (Rs.1,599) | O3+ Power (Rs.1,999) | O3+ Bridal (Rs.2,199)

*HAIR CARE:* Classic Spa (Rs.499) | Loreal (Rs.799) | Trimming (Rs.149) | Blow Dry (Rs.249) | Cut (Rs.249) | Root Touch (Rs.649) | Color (Rs.1,499) | Nanoplastia (Rs.2,499) | Keratin (Rs.1,499) | Global (Rs.2,499) | Global+ (Rs.3,999)

*CLEANUPS:* Fruit (Rs.349) | Red Wine (Rs.649) | Whiting (Rs.549) | Oxy Pro (Rs.549) | D-Tan (Rs.599)

*WAXING:* Face (Rs.299) | Arms (Rs.199-399) | Legs (Rs.299-599) | Full Body (Rs.1,199-1,999)

*BASIC:* Polishing (Rs.349-1,999) | Manicure (Rs.349) | Threading (Rs.30) | Lips (Rs.20-50) | Massage (Rs.249)

*BLEACH:* Herbal (Rs.249) | Back (Rs.299) | Arms (Rs.299) | Oxylife (Rs.349) | D-Tan (Rs.349) | Full Body (Rs.1,999)

*MAKEUP:* HD (Rs.1,999) | Silicon HD (Rs.2,999)`;
    
    default:
      return "Aap service select karein. A, B, C, D ya E reply karein.";
  }
}

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
    await axios.post(url, payload);
    console.log(`✅ PDF sent to ${toPhone}`);
  } catch (err) {
    console.error(`❌ PDF failed:`, err?.response?.data || err.message);
    await sendText(toPhone, `PDF link: ${pdfUrl}`);
  }
}

async function sendText(toPhone, text) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    await axios.post(url, { phone_number: toPhone, message_body: text, message_type: "text" });
    console.log(`✅ Text sent to ${toPhone}`);
  } catch (err) {
    console.error(`❌ Send failed:`, err?.response?.data || err.message);
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
          phone, name,
          text: selectedId || selectedTitle,
          hasMedia: false,
          isInteractive: true,
          interactiveId: selectedId.toUpperCase(),
        };
      }

      return {
        phone, name,
        text: msg?.text?.body || "",
        hasMedia: ["image","audio","video","document","sticker"].includes(msg?.type),
        isInteractive: false,
      };
    }
    return null;
  } catch (e) { return null; }
}

// TEST ENDPOINT - to verify WAPI can reach us
app.post("/test-webhook", async (req, res) => {
  try {
    console.log("\n🧪 TEST WEBHOOK RECEIVED!");
    console.log("Body:", JSON.stringify(req.body).substring(0, 200));
    res.json({ success: true, message: "Test webhook received successfully", timestamp: new Date() });
  } catch (err) {
    console.error("Test webhook error:", err.message);
    res.json({ success: false, error: err.message });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const parsed = parseWebhook(req.body);
    if (!parsed?.phone) return res.sendStatus(200);
    const { phone, name, text, hasMedia, isInteractive, interactiveId } = parsed;
    if (!text && !hasMedia) return res.sendStatus(200);
    if (text && text.trim() === "") return res.sendStatus(200);

    console.log(`\n📱 [${new Date().toLocaleTimeString()}] ${phone}: "${text.substring(0, 60)}"`);

    // Skip admin
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.endsWith("9560277217")) {
      console.log(`🔐 Admin message - skipping`);
      return res.sendStatus(200);
    }

    const isExactMatch = isExactTrigger(text);
    const hasHistory = conversations.has(phone) && getHistory(phone).length > 0;

    // Add lead on exact trigger
    if (!hasHistory && isExactMatch) {
      const firstName = name ? name.split(" ")[0] : "Unknown";
      await addActiveLead(phone, firstName, "", "", "WhatsApp Direct", "New Lead", text);
    }

    // Ignore if not exact trigger and no history
    if (!hasHistory && !isExactMatch) {
      console.log(`⏭️  IGNORED: Not exact trigger`);
      return res.sendStatus(200);
    }

    if (!BOT_ACTIVE) {
      console.log(`⛔ BOT_ACTIVE=false`);
      return res.sendStatus(200);
    }

    lastMessageTime.set(phone, Date.now());

    // NEW LEAD - Send menu
    if (!hasHistory && isExactMatch) {
      console.log(`🎯 NEW LEAD: Sending menu to ${phone}`);
      await new Promise(r => setTimeout(r, 1500));
      await sendMenuButtons(phone);
      pendingMenuSelect.add(phone);
      conversations.set(phone, []);
      addToHistory(phone, "assistant", MENU_TEXT);
      return res.sendStatus(200);
    }

    // MENU SELECTION
    if (pendingMenuSelect.has(phone)) {
      const selection = isInteractive ? (interactiveId || "") : detectMenuSelection(text);

      if (selection && ["A","B","C","D","E"].includes(selection)) {
        console.log(`📋 PATH ${selection}: ${phone}`);
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

        await new Promise(r => setTimeout(r, 1500));
        await sendText(phone, response);

        if (selection === "A" || selection === "B") {
          await new Promise(r => setTimeout(r, 2500));
          await sendPDF(phone, PREBRIDAL_PDF_URL, "Pre-Bridal Package Details");
        }
        
        return res.sendStatus(200);
      } else {
        await sendText(phone, "Aap A, B, C, D ya E reply karein");
        return res.sendStatus(200);
      }
    }

    // CONTINUING CONVERSATION
    if (hasHistory) {
      console.log(`💬 Conversation: ${phone}`);
      addToHistory(phone, "user", text);

      // CHECK BOT INTERVENTION EVERY TIME
      const canReplyNow = await checkBotIntervention(phone);
      if (!canReplyNow) {
        console.log(`🔕 Bot Intervention = NO - SILENT`);
        return res.sendStatus(200);
      }

      const lower = text.toLowerCase().trim();
      
      // Ask for location?
      const askingLocation = lower.includes("location") || lower.includes("address") || 
                            lower.includes("kahan") || lower.includes("where") ||
                            lower.includes("studio") || lower.includes("saath") ||
                            lower.includes("address") || lower.includes("pata");
      
      // Ask for Instagram?
      const askingInsta = lower.includes("instagram") || lower.includes("insta") ||
                         lower.includes("facebook") || lower.includes("social") ||
                         lower.includes("follow") || lower.includes("id");

      const hasBookingIntent = detectBookingIntent(text);
      const alreadySentContact = contactMessageSent.get(phone) || await hasContactMessageSent(phone);

      if (askingLocation) {
        console.log(`📍 Location request`);
        await new Promise(r => setTimeout(r, 1500));
        const locationResponse = `*Studio Address:*
H1/11, near Gurudwara
Vikaspuri, Delhi
(Near Janakpuri West Metro Station)

📞 Open: Tuesday - Sunday, 10 AM - 8 PM
❌ Closed: Monday`;
        
        await sendText(phone, locationResponse);
        addToHistory(phone, "assistant", locationResponse);
        await updateActiveLead(phone, { status: "Asked for Location" });
        
      } else if (askingInsta) {
        console.log(`📸 Instagram request`);
        await new Promise(r => setTimeout(r, 1500));
        const instaResponse = `Follow us! 💄

*Instagram:* @garimanagpalmua
https://www.instagram.com/garimanagpalmua/

Check transformations & specials! 🌟`;
        
        await sendText(phone, instaResponse);
        addToHistory(phone, "assistant", instaResponse);
        await updateActiveLead(phone, { status: "Asked for Instagram" });
        
      } else if (hasBookingIntent && !alreadySentContact) {
        console.log(`🎯 BOOKING INTENT - Sending contact ONCE`);
        contactMessageSent.set(phone, true);
        
        await new Promise(r => setTimeout(r, 1500));
        const contactResponse = `*Garima ma'am:*
📱 +91 93542 60517`;
        
        await sendText(phone, contactResponse);
        addToHistory(phone, "assistant", contactResponse);
        await updateActiveLead(phone, { status: "Booking Inquiry - Contact Sent" });
        
      } else {
        console.log(`⏳ No action - awaiting relevant query`);
      }
      
      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.sendStatus(200);
  }
});

app.get("/admin", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Beauty Box Admin</title><style>*{box-sizing:border-box;margin:0;padding:0;font-family:sans-serif}body{background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px}.card{background:#fff;border-radius:16px;padding:28px 24px;width:100%;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,0.1)}h2{font-size:18px;font-weight:600}label{font-size:13px;color:#666;display:block;margin:12px 0 5px}input,textarea{width:100%;padding:11px;border:1px solid #ddd;border-radius:8px;font-size:14px;margin-bottom:8px}button{width:100%;background:#128C7E;color:#fff;border:none;border-radius:8px;padding:12px;font-size:15px;font-weight:500;cursor:pointer}button:hover{background:#0d6b65}.msg{margin-top:12px;padding:10px;border-radius:8px;text-align:center;display:none}.ok{background:#e8f5e9;color:#2e7d32}.err{background:#fdeaea;color:#c62828}</style></head><body><div class="card"><h2>Beauty Box Admin</h2><label>Phone</label><input id="ph" placeholder="919999999999"><label>Name</label><input id="nm" placeholder="Customer Name"><label>Message</label><textarea id="msg" placeholder="Message" rows="3"></textarea><label>Key</label><input id="ky" type="password" placeholder="beautybox2024"><button onclick="send()">Send Message</button><div class="msg" id="res"></div></div><script>async function send(){const ph=document.getElementById('ph').value.trim();const ky=document.getElementById('ky').value.trim();if(!ph||!ky){show('Enter phone & key','err');return;}try{const r=await fetch('/admin/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,name:document.getElementById('nm').value.trim(),key:ky,message:document.getElementById('msg').value.trim()})});const d=await r.json();show(d.success?'✅ Sent!':d.error,'res',d.success?'ok':'err');}catch(e){show('❌ Error','res','err')}}function show(t,id,c){const el=document.getElementById(id);el.textContent=t;el.className='msg '+c;el.style.display='block'}</script></body></html>`);
});

app.post("/admin/start", async (req, res) => {
  const { phone, name, key, message } = req.body;
  if (key !== ADMIN_KEY) return res.json({ success: false, error: "Wrong key" });
  try {
    const firstName = name ? name.trim().split(" ")[0] : "";
    if (message) {
      await sendText(phone, message.trim());
      await addActiveLead(phone, firstName, "", "", "Admin", "Active", message);
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get("/", (req, res) => {
  res.json({
    agent: "Beauty Box Bot v4.5",
    status: "✅ RUNNING",
    trigger: "Hello! Can I get more info on this?",
    pdf_url: PREBRIDAL_PDF_URL,
    features: [
      "Exact trigger detection",
      "Location response",
      "Instagram sharing",
      "Contact message (once only)",
      "Bot Intervention check",
      "Google Sheets logging"
    ],
  });
});

app.listen(PORT, async () => {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`🚀 BEAUTY BOX BOT v4.5`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Port: ${PORT}`);
  console.log(`Status: ✅ ACTIVE`);
  console.log(`PDF URL: ${PREBRIDAL_PDF_URL}`);
  console.log(`\n📋 FEATURES:`);
  console.log(`✓ Exact trigger: "Hello! Can I get more info on this?"`);
  console.log(`✓ Location: "${PREBRIDAL_PDF_URL}"`);
  console.log(`✓ Instagram: @garimanagpalmua`);
  console.log(`✓ Contact: +91 93542 60517 (sent once)`);
  console.log(`✓ Bot Intervention: Column K check`);
  console.log(`✓ PDF: Short URL support`);
  console.log(`\n🔗 ENDPOINTS:`);
  console.log(`GET  / → Bot status`);
  console.log(`POST /webhook → WhatsApp messages`);
  console.log(`GET  /admin → Admin panel`);
  
  await initSheets();
  
  console.log(`\n✨ All systems ready!\n`);
});
