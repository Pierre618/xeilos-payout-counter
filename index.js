import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

/* ================= CONFIG ================= */
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PAYOUT_CHANNEL_ID = process.env.PAYOUT_CHANNEL_ID;
const VALIDATOR_ROLE_ID = process.env.VALIDATOR_ROLE_ID;
const STEP = Number(process.env.STEP || 100000);

/* ================= PATH FIX (ESM) ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================= DATABASE ================= */
const adapter = new JSONFile("data.json");
const db = new Low(adapter, {
  total: 0,
  step: STEP,
  lastPayout: 0,
  lastStudent: "",
  lastAt: 0,
  countedMessageIds: [],
  lastMilestoneAnnounced: 0,
  milestoneJustHit: false
});

await db.read();
db.data ||= {
  total: 0,
  step: STEP,
  lastPayout: 0,
  lastStudent: "",
  lastAt: 0,
  countedMessageIds: [],
  lastMilestoneAnnounced: 0,
  milestoneJustHit: false
};
await db.write();

/* ================= DISCORD BOT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel]
});

function parsePayoutAmount(text) {
  if (!text.toUpperCase().includes("PAYOUT")) return null;
  const match = text.match(/(\$?\s*\d[\d\s,]*\s*\$?)/);
  if (!match) return null;
  const amount = Number(match[1].replace(/[^\d]/g, ""));
  return amount > 0 ? amount : null;
}

client.once("ready", () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
});

client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) return;

    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const message = reaction.message;
    if (!message.guild) return;
    if (message.channelId !== PAYOUT_CHANNEL_ID) return;
    if (reaction.emoji.name !== "✅") return;

    const member = await message.guild.members.fetch(user.id);
    if (!member.roles.cache.has(VALIDATOR_ROLE_ID)) return;

    await db.read();

    if (db.data.countedMessageIds.includes(message.id)) return;

    const amount = parsePayoutAmount(message.content);
    if (!amount) return;

    db.data.total += amount;
    db.data.lastPayout = amount;
    db.data.lastStudent = message.author.username;
    db.data.lastAt = Date.now();
    db.data.countedMessageIds.push(message.id);

    const currentMilestone = Math.floor(db.data.total / STEP) * STEP;
    if (currentMilestone > db.data.lastMilestoneAnnounced) {
      db.data.lastMilestoneAnnounced = currentMilestone;
      db.data.milestoneJustHit = true;
    }

    await db.write();
  } catch (err) {
    console.error("Erreur reactionAdd:", err);
  }
});

/* ================= EXPRESS API ================= */
const app = express();

/* 🔥 IMPORTANT : servir le dossier public */
app.use(express.static(path.join(__dirname, "public")));

/* Page principale = widget */
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "widget.html"));
});

/* API JSON */
app.get("/payouts", async (_, res) => {
  await db.read();

  const payload = {
    total: db.data.total,
    step: STEP,
    lastPayout: db.data.lastPayout,
    lastStudent: db.data.lastStudent,
    lastAt: db.data.lastAt,
    milestone: db.data.lastMilestoneAnnounced,
    milestoneJustHit: db.data.milestoneJustHit
  };

  // reset one-shot
  db.data.milestoneJustHit = false;
  await db.write();

  res.json(payload);
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌍 API active sur le port ${PORT}`);
});

/* ================= LOGIN BOT ================= */
client.login(DISCORD_TOKEN);
