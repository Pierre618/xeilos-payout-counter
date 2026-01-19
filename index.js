import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { Client, GatewayIntentBits, Partials } from "discord.js";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

/* ================= PATH HELPERS (ESM) ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================= CONFIG ================= */
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PAYOUT_CHANNEL_ID = process.env.PAYOUT_CHANNEL_ID;
const VALIDATOR_ROLE_ID = process.env.VALIDATOR_ROLE_ID;
const STEP = Number(process.env.STEP || 100000); // $100k par défaut

if (!DISCORD_TOKEN) console.warn("⚠️ DISCORD_TOKEN manquant");
if (!PAYOUT_CHANNEL_ID) console.warn("⚠️ PAYOUT_CHANNEL_ID manquant");
if (!VALIDATOR_ROLE_ID) console.warn("⚠️ VALIDATOR_ROLE_ID manquant");

/* ================= DATABASE ================= */
const adapter = new JSONFile(path.join(__dirname, "data.json"));
const db = new Low(adapter, {
  total: 0,
  step: STEP,
  lastPayout: 0,
  lastStudent: "",
  lastAt: 0,
  countedMessageIds: [],
  lastMilestoneAnnounced: 0,
  milestoneJustHit: false,
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
  milestoneJustHit: false,
};
db.data.step = STEP; // keep in sync
await db.write();

/* ================= DISCORD BOT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

function parsePayoutAmount(text) {
  // On compte uniquement les messages qui contiennent "PAYOUT"
  if (!text || !text.toUpperCase().includes("PAYOUT")) return null;

  // Cherche un nombre du style: 1,000 / 1000 / $1,000 / 1 000 etc.
  const match = text.match(/(\$?\s*\d[\d\s,]*\s*\$?)/);
  if (!match) return null;

  const amount = Number(match[1].replace(/[^\d]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
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

    // sécurité: il faut que tout soit configuré
    if (!PAYOUT_CHANNEL_ID || !VALIDATOR_ROLE_ID) return;

    if (message.channelId !== PAYOUT_CHANNEL_ID) return;
    if (reaction.emoji.name !== "✅") return;

    const member = await message.guild.members.fetch(user.id);
    if (!member.roles.cache.has(VALIDATOR_ROLE_ID)) return;

    await db.read();

    // anti double comptage
    if (db.data.countedMessageIds.includes(message.id)) return;

    const amount = parsePayoutAmount(message.content);
    if (!amount) return;

    db.data.total += amount;
    db.data.lastPayout = amount;
    db.data.lastStudent = message.author?.username || "";
    db.data.lastAt = Date.now();
    db.data.countedMessageIds.push(message.id);

    // milestone (one-shot)
    const currentMilestone = Math.floor(db.data.total / STEP) * STEP;
    if (currentMilestone > db.data.lastMilestoneAnnounced) {
      db.data.lastMilestoneAnnounced = currentMilestone;
      db.data.milestoneJustHit = true;
    }

    await db.write();
  } catch (err) {
    console.error("❌ Erreur messageReactionAdd:", err);
  }
});

/* ================= API (EXPRESS) ================= */
const app = express();
app.use(cors());

// sert /public
app.use(express.static(path.join(__dirname, "public")));

// page principale: widget
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "widget.html"));
});

// endpoint JSON
app.get("/payouts", async (req, res) => {
  await db.read();

  const payload = {
    total: db.data.total,
    step: STEP,
    lastPayout: db.data.lastPayout,
    lastStudent: db.data.lastStudent,
    lastAt: db.data.lastAt,
    milestone: db.data.lastMilestoneAnnounced,
    milestoneJustHit: db.data.milestoneJustHit,
  };

  // one-shot milestone reset
  db.data.milestoneJustHit = false;
  await db.write();

  res.json(payload);
});

// health simple
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🌍 API active sur le port", PORT);
});

client.login(DISCORD_TOKEN);
