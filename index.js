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

// ===== UTIL =====
function escapeHtml(text) {
  if (typeof text !== "string") return String(text ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ===== /insta COMMAND =====
bot.command("insta", async (ctx) => {
  try {
    const text = ctx.message.text || "";
    const parts = text.split(/\s+/).filter(Boolean);
    const username = parts[1];
    if (!username) {
      return ctx.replyWithHTML(
        "<b>Usage:</b> <code>/insta username</code>",
        { reply_to_message_id: ctx.message.message_id }
      );
    }

    const apiUrl = `https://gamigo-admin-api.vercel.app/insta?username=${encodeURIComponent(username)}`;
    const { data } = await axios.get(apiUrl, { timeout: 12000 });

    const msg = [
      `<b>Instagram Profile</b>`,
      `👤 <b>Username:</b> <code>${escapeHtml(data.username)}</code>`,
      `🧾 <b>Full Name:</b> ${escapeHtml(data.full_name ?? "-")}`,
      `📝 <b>Bio:</b> ${escapeHtml(data.bio ?? "-")}`,
      `📦 <b>Posts:</b> ${Number(data.posts ?? 0)}`,
      `👥 <b>Followers:</b> ${Number(data.followers ?? 0)}`,
      `👤 <b>Following:</b> ${Number(data.following ?? 0)}`,
      `🔒 <b>Private:</b> ${data.private ? "Yes" : "No"}`,
      `✔️ <b>Verified:</b> ${data.verified ? "Yes" : "No"}`
    ].join("\n");

    await ctx.replyWithHTML(msg, { reply_to_message_id: ctx.message.message_id });
  } catch (e) {
    await ctx.replyWithHTML(
      `❌ <b>Failed to fetch profile:</b> <code>${escapeHtml(e.message)}</code>`,
      { reply_to_message_id: ctx.message.message_id }
    );
  }
});

// ===== /ai COMMAND (AI + Insta in one message) =====
bot.command("ai", async (ctx) => {
  try {
    const text = ctx.message.text || "";
    const question = text.replace(/^\/ai\s*/i, "").trim();
    if (!question) {
      return ctx.replyWithHTML(
        "<b>Usage:</b> <code>/ai your question here</code>",
        { reply_to_message_id: ctx.message.message_id }
      );
    }

    const aiUrl = `https://princeaiapi.vercel.app/prince/api/v1/ask?key=prince&ask=${encodeURIComponent(question)}`;
    const instaUsername = "im_.nilay._";
    const instaUrl = `https://gamigo-admin-api.vercel.app/insta?username=${encodeURIComponent(instaUsername)}`;

    const [aiRes, instaRes] = await Promise.all([
      axios.get(aiUrl, { timeout: 20000 }).catch((err) => ({ error: err })),
      axios.get(instaUrl, { timeout: 12000 }).catch((err) => ({ error: err }))
    ]);

    let aiMessage = "";
    if (!aiRes || aiRes.error) {
      aiMessage = `❌ Failed to get AI response: ${escapeHtml(aiRes?.error?.message || "unknown error")}`;
    } else {
      const aiData = aiRes.data || {};
      aiMessage = aiData?.message?.content || aiData?.answer || JSON.stringify(aiData);
    }

    let instaMessage = "";
    if (!instaRes || instaRes.error) {
      instaMessage = `❌ Failed to fetch Instagram profile: ${escapeHtml(instaRes?.error?.message || "unknown error")}`;
    } else {
      const d = instaRes.data || {};
      instaMessage = [
        `👤 <b>Username:</b> <code>${escapeHtml(d.username)}</code>`,
        `🧾 <b>Full Name:</b> ${escapeHtml(d.full_name ?? "-")}`,
        `📝 <b>Bio:</b> ${escapeHtml(d.bio ?? "-")}`,
        `📦 <b>Posts:</b> ${Number(d.posts ?? 0)}`,
        `👥 <b>Followers:</b> ${Number(d.followers ?? 0)}`,
        `👤 <b>Following:</b> ${Number(d.following ?? 0)}`,
        `🔒 <b>Private:</b> ${d.private ? "Yes" : "No"}`,
        `✔️ <b>Verified:</b> ${d.verified ? "Yes" : "No"}`
      ].join("\n");
    }

    const combined = [
      `<b>🤖 AI Response</b>`,
      escapeHtml(aiMessage),
      "",
      `<b>📸 Instagram Profile (${escapeHtml(instaUsername)})</b>`,
      instaMessage
    ].join("\n");

    await ctx.replyWithHTML(combined, { reply_to_message_id: ctx.message.message_id });
  } catch (e) {
    await ctx.replyWithHTML(
      `❌ <b>Failed:</b> <code>${escapeHtml(e.message)}</code>`,
      { reply_to_message_id: ctx.message.message_id }
    );
  }
});

// ===== /like COMMAND =====
bot.command("like", async (ctx) => {
  try {
    // Prefer reacting to the replied message; otherwise, show usage
    const replied = ctx.message.reply_to_message;
    if (!replied) {
      return ctx.replyWithHTML(
        "<b>Usage:</b> Reply to a message and send <code>/like</code> to react ❤️",
        { reply_to_message_id: ctx.message.message_id }
      );
    }

    const chatId = ctx.chat.id;
    const messageId = replied.message_id;

    // Try Telegram Bot API setMessageReaction (may not be available on older bot API versions)
    try {
      await bot.telegram.callApi("setMessageReaction", {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji: "❤️" }],
        is_big: true
      });
      await ctx.replyWithHTML("❤️ <b>Liked</b>", { reply_to_message_id: replied.message_id });
      return;
    } catch {
      // Fallback: send a simple heart reply if reactions are not supported
      await ctx.reply("❤️", { reply_to_message_id: replied.message_id });
      return;
    }
  } catch (e) {
    await ctx.replyWithHTML(
      `❌ <b>Failed to like:</b> <code>${escapeHtml(e.message)}</code>`,
      { reply_to_message_id: ctx.message.message_id }
    );
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
