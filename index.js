const express = require("express");
const axios = require("axios");
const path = require("path");
const { google } = require("googleapis");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const WAPI_VENDOR_UID = process.env.WAPI_VENDOR_UID || "";
const WAPI_TOKEN = process.env.WAPI_TOKEN || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "beautybox2024";
const BOT_ACTIVE = true;
const SHEET_ID = process.env.SHEET_ID || "";
const PREBRIDAL_PDF_URL = process.env.PREBRIDAL_PDF_URL || "https://bit.ly/4fbKIox";

let sheetsClient = null;

async function initSheets() {
  try {
    if (!process.env.GOOGLE_CREDENTIALS || !SHEET_ID) {
      console.log("⚠️ Sheets disabled -- credentials or SHEET_ID missing");
      return;
    }
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    console.log("✅ Google Sheets connected");
  } catch (err) {
    console.error("❌ Sheets init failed:", err.message);
  }
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

async function addActiveLead(phone, name, source, lastMsg) {
  if (!sheetsClient) {
    console.log("⚠️ Sheets not connected");
    return;
  }
  try {
    const existing = await findRow("Active Leads", phone);
    if (existing > 0) return;

    const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A:K",
      valueInputOption: "RAW",
      resource: {
        values: [[
          phone,
          name || "",
          "",
          "",
          source || "WhatsApp",
          "New Lead",
          (lastMsg || "").substring(0, 200),
          now,
          now,
          "",
          "Yes",
        ]],
      },
    });
    console.log(`✅ Lead added to Sheets: ${phone}`);
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
    const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const updated = [
      current[0] || phone,
      updates.name || current[1] || "",
      current[2] || "",
      current[3] || "",
      current[4] || "",
      updates.status || current[5] || "Active",
      (updates.lastMsg || current[6] || "").substring(0, 200),
      current[7] || now,
      now,
      updates.servicePath || current[9] || "",
      current[10] || "Yes",
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

async function checkBotIntervention(phone) {
  if (!sheetsClient) return true;
  try {
    const row = await findRow("Active Leads", phone);
    if (row < 1) return true;

    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!K${row}`,
    });
    const val = res.data.values?.[0]?.[0] || "Yes";
    const isOn = val.toString().trim().toLowerCase() === "yes" || val.toString().trim() === "" || val.toString().trim().toLowerCase() === "y";
    
    console.log(`🔍 Bot Intervention check for ${phone}: ${isOn ? "✅ ON" : "❌ OFF"}`);
    return isOn;
  } catch (err) {
    return true;
  }
}

const conversations = new Map();
const pendingMenuSelect = new Set();
const customerPath = new Map();
const contactMessageSent = new Map();

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}

const MENU_TEXT = `Welcome to Beauty Box Makeup Studio 💄

Aap kaunsi service ke baare mein jaanna chahti hain?

*A* -- Pre-Bridal Package
*B* -- Pre Bridal+ Bridal Makeup Combo
*C* -- Hydra Facial Package
*D* -- Nail Services
*E* -- Other Beauty Services

Reply A, B, C, D ya E karein`;

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

  switch (selection) {
    case "A":
      return `${name}*PRE-BRIDAL PACKAGE - Rs.7,499* (Market Value Rs.16,800 - Save Rs.12,001 / 71% OFF)

*12 Services in 3 Sittings:*

*1st Sitting:* O3+ Facial, Bleach/D-Tan
*2nd Sitting:* Full Body Bleach, Manicure, Pedicure, Loreal Hair Spa
*3rd Sitting:* Full Body Wax, Polishing, Nail Extension, Face Bleach & O3+ Facial, Threading & Upper Lips

Premium Products | Hygienic Care | Flexible Appointments`;

    case "B":
      return `${name}*PRE-BRIDAL + BRIDAL MAKEUP COMBO - Rs.16,500* (Save Rs.1,999)

Includes:
- Complete Pre-Bridal Package (12 services in 3 sittings)
- Bridal Makeup (Waterproof, Soft Glam, Lashes & Lenses, Draping + Hairstyle)`;

    case "C":
      return `${name}*HYDRA FACIAL PACKAGE*

*Single Sitting:* Rs.1,199
*3-Sitting Package:* Rs.2,999 (Recommended)

Benefits: Deep hydration, Brightening, Skin barrier restore, 60-70% improvement`;

    case "D":
      return `${name}*NAIL SERVICES*

Extension (Rs.599+) | Natural (Rs.349+) | Acrylic (Rs.699+) | Gel (Rs.899+)

Pedicure: Classic (Rs.399) | Spa (Rs.449) | French (Rs.549) | Gel (Rs.749) | Korean (Rs.899)`;

    case "E":
      return `${name}*COMPLETE PRICE LIST*

Facials (Rs.499-2,199) | Hair Care (Rs.149-3,999) | Cleanups (Rs.349-649)
Waxing (Rs.199-1,999) | Manicure/Threading | Bleach (Rs.249-1,999)
Makeup: HD (Rs.1,999) | Silicon HD (Rs.2,999)`;

    default:
      return "Aap service select karein. A, B, C, D ya E reply karein.";
  }
}

async function sendText(toPhone, text) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    await axios.post(url, {
      phone_number: toPhone,
      message_body: text,
      message_type: "text",
    });
    console.log(`✅ Text sent to ${toPhone}`);
  } catch (err) {
    console.error(`❌ Send failed:`, err?.response?.data?.message || err.message);
  }
}

async function sendPDF(toPhone, pdfUrl, caption) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    await axios.post(url, {
      phone_number: toPhone,
      message_type: "media",
      media: {
        url: pdfUrl,
        type: "document",
        caption: caption || "",
      },
    });
    console.log(`✅ PDF sent to ${toPhone}`);
  } catch (err) {
    console.error(`❌ PDF failed:`, err?.response?.data?.message || err.message);
    await sendText(toPhone, `PDF: ${pdfUrl}`);
  }
}

function parseWebhook(body) {
  try {
    console.log("🔍 Parsing payload:", JSON.stringify(body).substring(0, 150));
    
    // Try WhatsApp Cloud API format
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (messages?.length > 0) {
      const msg = messages[0];
      const contacts = body?.entry?.[0]?.changes?.[0]?.value?.contacts || [];
      const phone = msg?.from || "";
      const name = contacts[0]?.profile?.name || null;

      console.log(`✅ WhatsApp Cloud format - Phone: ${phone}`);
      return {
        phone,
        name,
        text: msg?.text?.body || "",
        hasMedia: !!msg?.type && msg.type !== "text",
      };
    }

    // Try WAPI format - phone in contact, text in message
    if (body?.contact?.phone_number || body?.data?.contact?.phone_number) {
      const phone = body?.contact?.phone_number || body?.data?.contact?.phone_number || "";
      const text = body?.message?.body || body?.data?.message?.body || "";
      const name = body?.contact?.first_name || body?.data?.contact?.first_name || null;

      console.log(`✅ WAPI format - Phone: ${phone}, Text: ${text.substring(0, 50)}`);
      return {
        phone,
        name,
        text,
        hasMedia: false,
      };
    }

    // Try alternate WAPI format
    if (body?.phone_number || body?.sender) {
      const phone = body?.phone_number || body?.sender || "";
      const text = body?.message || body?.text || "";
      const name = body?.name || null;

      console.log(`✅ Alternate format - Phone: ${phone}, Text: ${text.substring(0, 50)}`);
      return {
        phone,
        name,
        text,
        hasMedia: false,
      };
    }

    console.log("❌ Could not parse payload - unknown format");
    console.log("Full payload:", JSON.stringify(body));
    return null;
  } catch (e) {
    console.error("❌ Parse webhook error:", e.message);
    return null;
  }
}

// TEST WEBHOOK - For diagnostics
app.post("/test-webhook", (req, res) => {
  console.log("\n🧪 TEST WEBHOOK RECEIVED!");
  console.log("Body sample:", JSON.stringify(req.body).substring(0, 100));
  res.json({ success: true, message: "Test webhook working!" });
});

// MAIN WEBHOOK
app.post("/webhook", async (req, res) => {
  try {
    console.log("\n📨 WEBHOOK REQUEST RECEIVED");
    
    const parsed = parseWebhook(req.body);
    if (!parsed?.phone) {
      console.log("⏭️ No phone found in payload");
      return res.sendStatus(200);
    }

    const { phone, name, text } = parsed;
    if (!text || text.trim() === "") {
      console.log("⏭️ No text in message");
      return res.sendStatus(200);
    }

    console.log(`📱 [${new Date().toLocaleTimeString()}] ${phone}: "${text.substring(0, 60)}"`);

    // Skip admin
    if (phone.replace(/\D/g, "").endsWith("9560277217")) {
      console.log("🔐 Admin message - skipping");
      return res.sendStatus(200);
    }

    if (!BOT_ACTIVE) {
      console.log("⛔ BOT_ACTIVE = false");
      return res.sendStatus(200);
    }

    const hasHistory = conversations.has(phone) && getHistory(phone).length > 0;
    const isExactTrigger = text.trim().toLowerCase() === "Hello! Can I get more info on this?".toLowerCase();

    // NEW LEAD
    if (!hasHistory && isExactTrigger) {
      console.log(`🎯 NEW LEAD: ${phone}`);
      const firstName = name ? name.split(" ")[0] : "Unknown";
      await addActiveLead(phone, firstName, "WhatsApp", text);

      conversations.set(phone, []);
      await new Promise(r => setTimeout(r, 1000));
      await sendText(phone, MENU_TEXT);
      pendingMenuSelect.add(phone);
      return res.sendStatus(200);
    }

    // Ignore non-trigger messages without history
    if (!hasHistory && !isExactTrigger) {
      console.log(`⏭️ IGNORED: No trigger match`);
      return res.sendStatus(200);
    }

    // MENU SELECTION
    if (pendingMenuSelect.has(phone)) {
      const selection = detectMenuSelection(text);

      if (selection && ["A", "B", "C", "D", "E"].includes(selection)) {
        console.log(`📋 PATH ${selection}: ${phone}`);
        pendingMenuSelect.delete(phone);
        customerPath.set(phone, selection);

        const customerName = name ? name.split(" ")[0] : "";
        const response = getServiceResponse(selection, customerName);

        await new Promise(r => setTimeout(r, 1000));
        await sendText(phone, response);

        if (selection === "A" || selection === "B") {
          await new Promise(r => setTimeout(r, 2000));
          await sendPDF(phone, PREBRIDAL_PDF_URL, "Pre-Bridal Package Details");
        }

        await updateActiveLead(phone, {
          status: `Selected: ${selection}`,
          servicePath: selection,
        });

        return res.sendStatus(200);
      } else {
        await sendText(phone, "Aap A, B, C, D ya E reply karein");
        return res.sendStatus(200);
      }
    }

    // CONTINUING CONVERSATION
    if (hasHistory) {
      console.log(`💬 Continuing conversation: ${phone}`);

      // CHECK BOT INTERVENTION EVERY TIME
      const canReply = await checkBotIntervention(phone);
      if (!canReply) {
        console.log(`🔕 Bot Intervention OFF - SILENT`);
        return res.sendStatus(200);
      }

      const lower = text.toLowerCase().trim();

      // Location request
      if (lower.includes("location") || lower.includes("address") || lower.includes("kahan") || lower.includes("studio")) {
        console.log(`📍 Location request`);
        await new Promise(r => setTimeout(r, 1000));
        const locationMsg = `*Studio Address:*\nH1/11, near Gurudwara\nVikaspuri, Delhi\n(Near Janakpuri West Metro)\n\n📞 +91 93542 60517\n⏰ Tue-Sun: 10 AM - 8 PM`;
        await sendText(phone, locationMsg);
        await updateActiveLead(phone, { status: "Asked Location" });
        return res.sendStatus(200);
      }

      // Instagram request
      if (lower.includes("instagram") || lower.includes("insta") || lower.includes("follow")) {
        console.log(`📸 Instagram request`);
        await new Promise(r => setTimeout(r, 1000));
        const instaMsg = `Follow us! 💄\n\n@garimanagpalmua\nhttps://www.instagram.com/garimanagpalmua/`;
        await sendText(phone, instaMsg);
        await updateActiveLead(phone, { status: "Asked Instagram" });
        return res.sendStatus(200);
      }

      // Booking intent
      const bookingWords = ["book", "slot", "available", "kab", "call", "number", "price", "cost"];
      const hasBooking = bookingWords.some(word => lower.includes(word));
      const alreadySent = contactMessageSent.get(phone);

      if (hasBooking && !alreadySent) {
        console.log(`🎯 BOOKING INTENT - First time`);
        contactMessageSent.set(phone, true);
        await new Promise(r => setTimeout(r, 1000));
        const contactMsg = `*Garima ma'am:*\n📱 +91 93542 60517`;
        await sendText(phone, contactMsg);
        await updateActiveLead(phone, { status: "Booking Inquiry" });
        return res.sendStatus(200);
      }

      if (hasBooking && alreadySent) {
        console.log(`⏳ Booking intent but already sent contact`);
        return res.sendStatus(200);
      }

      console.log(`⏳ Other query - no action`);
      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.sendStatus(200);
  }
});

app.get("/", (req, res) => {
  res.json({
    agent: "Beauty Box Bot v4.7",
    status: "✅ RUNNING",
    features: ["Exact trigger", "Menu selection", "PDF sending", "Location", "Instagram", "Booking contact"],
  });
});

app.get("/admin", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html><html><head><title>Beauty Box Admin</title><style>body{font-family:sans-serif;background:#f5f5f5;display:flex;justify-content:center;padding:20px}.card{background:#fff;border-radius:12px;padding:30px;width:100%;max-width:400px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}h2{margin:0 0 20px 0}label{display:block;font-size:13px;color:#666;margin-top:12px;margin-bottom:5px}input,textarea{width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;font-family:inherit;margin-bottom:8px;box-sizing:border-box}button{width:100%;background:#128C7E;color:#fff;border:none;border-radius:8px;padding:12px;font-size:15px;font-weight:600;cursor:pointer;margin-top:10px}button:hover{background:#0d6b65}.msg{margin-top:15px;padding:12px;border-radius:8px;text-align:center;display:none;font-size:14px}.ok{background:#e8f5e9;color:#2e7d32}.err{background:#ffebee;color:#c62828}</style></head><body><div class="card"><h2>Beauty Box Admin</h2><label>Phone (with +91)</label><input id="ph" placeholder="919999999999"><label>Name</label><input id="nm" placeholder="Customer"><label>Message</label><textarea id="msg" rows="3" placeholder="Message"></textarea><label>Admin Key</label><input id="ky" type="password" placeholder="beautybox2024"><button onclick="send()">Send</button><div class="msg" id="res"></div></div><script>async function send(){const ph=document.getElementById('ph').value.trim();const ky=document.getElementById('ky').value.trim();if(!ph||!ky){show('Enter phone & key','err');return}try{const r=await fetch('/admin/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,name:document.getElementById('nm').value.trim(),key:ky,message:document.getElementById('msg').value.trim()})});const d=await r.json();show(d.success?'✅ Sent':'Error',d.success?'ok':'err')}catch(e){show('Error','err')}}function show(t,c){const el=document.getElementById('res');el.textContent=t;el.className='msg '+c;el.style.display='block'}</script></body></html>`);
});

app.post("/admin/send", async (req, res) => {
  const { phone, name, key, message } = req.body;
  if (key !== ADMIN_KEY) return res.json({ success: false });
  try {
    if (message) await sendText(phone, message);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.listen(PORT, async () => {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`🚀 BEAUTY BOX BOT v4.7`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Port: ${PORT}`);
  console.log(`Status: ✅ ACTIVE`);
  console.log(`PDF: ${PREBRIDAL_PDF_URL}`);
  console.log(`\n✨ Ready for WhatsApp messages!\n`);

  await initSheets();
});
