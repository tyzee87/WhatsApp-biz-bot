const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "funditekniq_verify_token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;      // Meta permanent token
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;    // From Meta dashboard
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ─── SYSTEM PROMPT ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a friendly and professional WhatsApp customer support agent for Funditekniq Building Stone Supply. Respond in English, warmly and concisely (1–3 sentences), like a real business chat agent. Do not use markdown, bullet points, or bold text — plain text only, suitable for WhatsApp.

About the business:
- Name: Funditekniq Building Stone Supply
- We supply high-quality dressed building stones in various colours and sizes.
- Store hours: Monday to Saturday, 8:00 AM – 5:00 PM.
- We deliver as per client requirements.
- For urgent human support, clients can call or WhatsApp: +254791956965 or +254754070058.

Products & Pricing:
1. 6x9 inch Dressed Coloured Stone (Yellow, Red, Brown, Grey, Black) - KES 45 per foot
2. 6x9 inch Dressed Bouch Coloured Stone (Yellow, Red, Brown, Grey, Black) - KES 95 per foot
3. 9x9 inch Jungle Stone - KES 35 per foot

How to handle enquiries:
- For pricing questions, give the prices above clearly and ask if they would like to place an order.
- For orders, ask for the client preferred stone type, colour, quantity (in feet), and delivery location, then confirm we will get back to them to arrange delivery.
- For complaints, apologize sincerely and assure them a human agent will follow up. Give the contact numbers.
- For store hours or location questions, give the hours and mention we deliver anywhere as per client needs.
- If you do not know something, say you will connect them with an agent and give the contact numbers.
- Never make up prices or products not listed above.`;

// ─── IN-MEMORY CONVERSATION STORE ───────────────────────────────────────────
// Stores last 10 messages per phone number for context
const conversations = {};

function getHistory(phone) {
  if (!conversations[phone]) conversations[phone] = [];
  return conversations[phone];
}

function addToHistory(phone, role, content) {
  if (!conversations[phone]) conversations[phone] = [];
  conversations[phone].push({ role, content });
  // Keep last 10 messages to avoid token overflow
  if (conversations[phone].length > 10) {
    conversations[phone] = conversations[phone].slice(-10);
  }
}

// ─── SEND WHATSAPP MESSAGE ───────────────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ─── CALL CLAUDE AI ──────────────────────────────────────────────────────────
async function getAIReply(phone, userMessage) {
  addToHistory(phone, "user", userMessage);
  const history = getHistory(phone);

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: history,
    },
    {
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    }
  );

  const reply = response.data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  addToHistory(phone, "assistant", reply);
  return reply;
}

// ─── WEBHOOK VERIFICATION (Meta requires this) ───────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta");
    res.status(200).send(challenge);
  } else {
    console.error("❌ Webhook verification failed");
    res.sendStatus(403);
  }
});

// ─── INCOMING MESSAGE HANDLER ────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  // Always respond 200 immediately so Meta doesn't retry
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Ignore status updates (delivered, read, etc.)
    if (!value?.messages) return;

    const message = value.messages[0];
    const from = message.from; // Sender's phone number

    // Only handle text messages for now
    if (message.type !== "text") {
      await sendWhatsAppMessage(
        from,
        "Sorry, I can only handle text messages right now. Please type your question and I will be happy to help!"
      );
      return;
    }

    const userText = message.text.body;
    console.log(`📩 Message from ${from}: ${userText}`);

    const aiReply = await getAIReply(from, userText);
    console.log(`🤖 AI Reply to ${from}: ${aiReply}`);

    await sendWhatsAppMessage(from, aiReply);
  } catch (err) {
    console.error("Error handling message:", err?.response?.data || err.message);
  }
});

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "Funditekniq WhatsApp Bot is running ✅" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
