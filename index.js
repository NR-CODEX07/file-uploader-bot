import express from "express";
import axios from "axios";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { Telegraf, session } from "telegraf";

// ===== CONFIG =====
const BOT_TOKEN = "8431553291:AAHSsOuvebj9GRnzuf0PotpCtthAwDYMWYM";
const VERCEL_URL = "https://file-uploader-bot-rust.vercel.app";
const FIREBASE_DB_URL = "https://nilay-database-default-rtdb.firebaseio.com";
const ADMIN_ID = "6761595092";
// ==================

const bot = new Telegraf(BOT_TOKEN);
const app = express();
const TMP_DIR = "/tmp"; // Temporary storage for Vercel

// ===== ROOT ROUTE =====
app.get("/", (req, res) => {
  res.send("Bot is running ✅");
});

// ===== WEBHOOK =====
app.use(bot.webhookCallback("/webhook"));
app.get("/setwebhook", async (req, res) => {
  try {
    await bot.telegram.setWebhook(`${VERCEL_URL}/webhook`);
    res.send("Webhook set successfully ✅");
  } catch (e) {
    res.status(500).send("Error setting webhook: " + e.message);
  }
});

bot.use(session());

// ===== START COMMAND =====
bot.start(async (ctx) => {
  const id = ctx.from.id;
  const name = ctx.from.first_name;
  const userData = { telegramid: id, first_name: name, date: Date.now() };

  try {
    const existing = await axios.get(`${FIREBASE_DB_URL}/users/${id}.json`);
    if (!existing.data) {
      await axios.put(`${FIREBASE_DB_URL}/users/${id}.json`, userData);
      const resUsers = await axios.get(`${FIREBASE_DB_URL}/users.json`);
      const totalUsers = Object.keys(resUsers.data || {}).length;
      const message = `➕ <b>New User Notification</b> ➕\n\n👤<b>User:</b> <a href="tg://user?id=${id}">${name}</a>\n\n🆔<b>User ID:</b> <code>${id}</code>\n\n🌝 <b>Total Users Count: ${totalUsers}</b>`;
      await bot.telegram.sendMessage(ADMIN_ID, message, { parse_mode: "HTML" });
    }
  } catch {}

  await ctx.replyWithHTML(
    `👋<b>Welcome <a href="tg://user?id=${id}">${name}</a>,\n\nI can host your files for free. Send me a file (up to 2 GB).</b>`,
    { reply_to_message_id: ctx.message.message_id }
  );
});

// ===== BROADCAST =====
bot.command("broadcast", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return;
  ctx.session.broadcast = true;
  await ctx.reply("<b>Enter Broadcast Message Here 👇</b>", {
    parse_mode: "HTML",
    reply_to_message_id: ctx.message.message_id
  });
});

bot.on("message", async (ctx, next) => {
  ctx.session = ctx.session || {};
  if (ctx.session.broadcast && ctx.from.id.toString() === ADMIN_ID) {
    ctx.session.broadcast = false;
    const broadcastMsg = ctx.message.message_id;
    try {
      const res = await axios.get(`${FIREBASE_DB_URL}/users.json`);
      const users = res.data || {};
      let count = 0;
      for (const uid of Object.keys(users)) {
        try {
          await ctx.copyMessage(uid, ctx.chat.id, broadcastMsg);
          count++;
          await new Promise(r => setTimeout(r, 300));
        } catch {}
      }
      await ctx.reply(`✅ Broadcast sent to ${count} users.`);
    } catch (e) {
      await ctx.reply(`❌ Broadcast failed: ${e.message}`);
    }
  } else {
    await next();
  }
});

// ===== FILE HANDLER (supports >30MB) =====
bot.on(["document", "video", "photo", "sticker", "animation"], async (ctx) => {
  let file_id, file_name;

  if (ctx.message.document) {
    file_id = ctx.message.document.file_id;
    file_name = ctx.message.document.file_name || "file";
  } else if (ctx.message.video) {
    file_id = ctx.message.video.file_id;
    file_name = "video.mp4";
  } else if (ctx.message.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    file_id = photo.file_id;
    file_name = "image.jpg";
  } else if (ctx.message.sticker) {
    file_id = ctx.message.sticker.file_id;
    file_name = "sticker.webp";
  } else if (ctx.message.animation) {
    file_id = ctx.message.animation.file_id;
    file_name = ctx.message.animation.file_name || "animation.gif";
  } else return;

  const file = await ctx.telegram.getFile(file_id);
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

  const id = randomBytes(8).toString("hex");
  const filePath = path.join(TMP_DIR, `${id}-${file_name}`);

  // Download as stream to /tmp
  const writer = fs.createWriteStream(filePath);
  const response = await axios.get(url, { responseType: "stream" });
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  const link = `${VERCEL_URL}/upload?id=${id}&name=${encodeURIComponent(file_name)}`;

  try {
    await axios.post(`${FIREBASE_DB_URL}/links.json`, {
      link,
      name: ctx.from.first_name,
      id: ctx.from.id,
      time: Date.now()
    });
  } catch {}

  await ctx.reply(link, { reply_to_message_id: ctx.message.message_id });
});

// ===== UPLOAD ROUTE =====
app.get("/upload", (req, res) => {
  const { id, name } = req.query;
  const filePath = path.join(TMP_DIR, `${id}-${name}`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Content-Type", "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
});

export default app;
