# Beauty Box AI Agent — Setup Guide
### WhatsApp AI for Beauty Box Makeup Studio by Garima Nagpal

---

## How it works

```
Customer sends WhatsApp message
        ↓
wapi.in.net receives it
        ↓
Sends POST to your webhook (this server)
        ↓
Server calls Claude AI with your system prompt
        ↓
Claude replies in Garima's style (Hinglish, short, warm)
        ↓
Server sends reply back to customer via wapi.in.net
        ↓
Customer sees the reply on WhatsApp ✅
```

---

## STEP 1 — Get your Anthropic API Key

1. Go to → https://console.anthropic.com
2. Sign up / Log in
3. Click **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-...`)
5. Save it — you'll need it in Step 3

---

## STEP 2 — Set up wapi.in.net

1. Go to → https://panel.wapi.in.net
2. Sign up and choose a plan (₹499/month)
3. Click **Create Instance** (or Add Device)
4. A **QR code** will appear on screen
5. Open WhatsApp on your phone → **Linked Devices** → **Link a Device**
6. Scan the QR code → Your number is now connected ✅
7. From the dashboard, copy:
   - **Instance ID**
   - **API Token**
8. Save these — you'll need them in Step 3

---

## STEP 3 — Deploy to Railway (free, 1-click)

Railway is the easiest way to host this server. No technical knowledge needed.

### Option A — Deploy via GitHub (Recommended)

1. Go to → https://github.com → Create a free account
2. Create a new repository called `beautybox-agent`
3. Upload all files from this folder to the repository
4. Go to → https://railway.app → Sign up with GitHub
5. Click **New Project** → **Deploy from GitHub repo**
6. Select `beautybox-agent`
7. Railway will auto-detect Node.js and deploy ✅

### Option B — Deploy via Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### After deploying — Add Environment Variables in Railway

1. In Railway dashboard → Your project → **Variables**
2. Add these 3 variables:

```
ANTHROPIC_API_KEY  =  sk-ant-xxxxxxxx   (from Step 1)
WAPI_INSTANCE_ID   =  your_instance_id  (from Step 2)
WAPI_TOKEN         =  your_token        (from Step 2)
```

3. Railway will auto-restart with the new variables
4. Copy your Railway URL — it looks like:
   `https://beautybox-agent-production.up.railway.app`

---

## STEP 4 — Set Webhook URL in wapi.in.net

1. Go to → https://panel.wapi.in.net
2. Open your Instance → **Settings** or **Webhook**
3. Paste your Railway URL + `/webhook`:
   ```
   https://beautybox-agent-production.up.railway.app/webhook
   ```
4. Save ✅

---

## STEP 5 — Test it!

1. From any phone, send a WhatsApp message to your Beauty Box number
2. The AI should reply within 3-5 seconds
3. Watch the Railway logs to see the conversation in real time

---

## When to jump in manually (as Garima)

The AI will handle the full conversation and say:
> "Main Garima ma'am ko inform karti hoon — wo aapko QR code share kar deti hain 🥰"

**That's your cue!** Open the wapi.in.net chat panel, find the conversation, and:
- Send the QR code image for payment
- Confirm the visit slot/timing
- Handle any discount discussions

---

## Troubleshooting

| Problem | Fix |
|---|---|
| AI not replying | Check Railway logs — likely missing API key |
| Messages not reaching server | Check webhook URL in wapi.in.net settings |
| Wrong phone number format | wapi uses numbers without + e.g. `919999999999` |
| AI replying to own messages | The `fromMe` filter handles this — check logs |

---

## Files in this project

```
beautybox-webhook/
├── index.js        ← Main server (webhook + AI logic)
├── package.json    ← Node.js dependencies
├── .env.example    ← Copy to .env with your real keys
└── README.md       ← This file
```

---

## Support

Built for Beauty Box Makeup Studio by Garima Nagpal, Vikaspuri, Delhi.
Instagram: https://www.instagram.com/garimanagpalmua/
