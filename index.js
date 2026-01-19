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

/* ================= PATH HELPERS ================= */
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
  if (!text) return null;
  if (!text.toUpperCase().includes("PAYOUT")) return null;

  // Ex: "PAYOUT $500" / "PAYOUT 500$" / "PAYOUT 1 200$"
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

    // 1) Bon channel
    if (message.channelId !== PAYOUT_CHANNEL_ID) return;

    // 2) Bonne emoji
    if (reaction.emoji.name !== "✅") return;

    // 3) Validateur uniquement
    const member = await message.guild.members.fetch(user.id);
    if (!member.roles.cache.has(VALIDATOR_ROLE_ID)) return;

    await db.read();

    // 4) Déjà compté ?
    if (db.data.countedMessageIds.includes(message.id)) return;

    // 5) Montant
    const amount = parsePayoutAmount(message.content);
    if (!amount) return;

    // Update DB
    db.data.total += amount;
    db.data.lastPayout = amount;
    db.data.lastStudent = message.author?.username || "";
    db.data.lastAt = Date.now();
    db.data.countedMessageIds.push(message.id);

    // Milestone / step
    const currentMilestone = Math.floor(db.data.total / STEP) * STEP;
    if (currentMilestone > db.data.lastMilestoneAnnounced) {
      db.data.lastMilestoneAnnounced = currentMilestone;
      db.data.milestoneJustHit = true; // one-shot pour l’overlay
    }

    await db.write();

    console.log(
      `✅ Payout validé: +${amount}$ | total=${db.data.total}$ | milestone=${db.data.lastMilestoneAnnounced}$`
    );
  } catch (err) {
    console.error("Erreur reactionAdd:", err);
  }
});

/* ================= EXPRESS API ================= */
const app = express();

/* ================= ÉTAPE 2 — LE BLOC À AJOUTER (AVANT app.listen) ================= */
/* ✅ Sert le dossier /public (widget.html + cash.mp3 etc.) */
app.use(express.static(path.join(__dirname, "public")));

/* ✅ Route racine → affiche widget.html */
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "widget.html"));
});
/* ================= FIN ÉTAPE 2 ================= */

/* ✅ Endpoint JSON pour l’overlay */
app.get("/payouts", async (_req, res) => {
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

  // one-shot milestone
  db.data.milestoneJustHit = false;
  await db.write();

  res.json(payload);
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🌍 API + widget actifs sur le port", PORT);
});

/* ================= LOGIN BOT ================= */
client.login(DISCORD_TOKEN);
