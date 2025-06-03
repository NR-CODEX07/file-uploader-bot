import express from "express"
import axios from "axios"
import { Telegraf, session } from "telegraf"
import { randomBytes } from "crypto"
import bodyParser from "body-parser"

const BOT_TOKEN = "7784028733:AAHANG4AtqTcXhOSHtUT1x0_9q0XX98ultg"
const VERCEL_URL = "https://image-uploader-bot.vercel.app"
const FIREBASE_DB_URL = "https://flecdev-efed1-default-rtdb.firebaseio.com"
const ADMIN_ID = "7320532917"

const bot = new Telegraf(BOT_TOKEN)
const app = express()
const storage = {}
const MAX_SIZE = 30 * 1024 * 1024

app.use(bodyParser.json())
app.use(bot.webhookCallback("/"))
bot.use(session())

bot.telegram.setWebhook(`${VERCEL_URL}/`)

bot.start(async (ctx) => {
  const id = ctx.from.id
  const name = ctx.from.first_name
  const userData = { telegramid: id, first_name: name, date: Date.now() }
  try {
    await axios.put(`${FIREBASE_DB_URL}/users/${id}.json`, userData)
    const res = await axios.get(`${FIREBASE_DB_URL}/users.json`)
    const totalUsers = Object.keys(res.data || {}).length
    const message = `➕ <b>New User Joined</b> ➕\n\n👤 <b>User:</b> <a href="tg://user?id=${id}">${name}</a>\n🆔 <b>User ID:</b> <code>${id}</code>\n\n🌟 <b>Total Users:</b> <code>${totalUsers}</code>`
    await bot.telegram.sendMessage(ADMIN_ID, message, { parse_mode: "HTML" })
  } catch {}
  await ctx.replyWithHTML(
    `👋 <b>Welcome <a href="tg://user?id=${id}">${name}</a>!\n\nShare any file under 30 MB, and I'll host it for you free of cost. Use /myfiles to see all your uploaded files.</b>`
  )
})

bot.command("webhook", async (ctx) => {
  try {
    await bot.telegram.setWebhook(`${VERCEL_URL}/`)
    ctx.reply("✅ Webhook set successfully!", { reply_to_message_id: ctx.message.message_id })
  } catch (e) {
    ctx.reply(`❌ Error setting webhook: ${e.message}`, { reply_to_message_id: ctx.message.message_id })
  }
})

bot.command("broadcast", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return
  ctx.session.broadcast = true
  await ctx.reply("📢 <b>Send the broadcast message or media now.</b>", { parse_mode: "HTML" })
})

bot.command("myfiles", async (ctx) => {
  const id = ctx.from.id
  try {
    const res = await axios.get(`${FIREBASE_DB_URL}/links.json`)
    const allLinks = res.data || {}
    const userLinks = Object.values(allLinks).filter(l => l.id === id)
    if (userLinks.length === 0) {
      await ctx.reply("📁 You have no uploaded files yet.")
      return
    }
    const lines = userLinks.map((l, i) => `${i + 1}. ${l.link}`)
    const txtContent = lines.join("\n")
    const buffer = Buffer.from(txtContent, "utf-8")
    await ctx.replyWithDocument({ source: buffer, filename: "my_uploaded_files.txt" }, { caption: `📁 <b>Your Uploaded Files (${userLinks.length} total)</b>`, parse_mode: "HTML" })
  } catch {
    await ctx.reply("❌ Failed to retrieve your files, please try again later.")
  }
})

bot.on("message", async (ctx, next) => {
  if (ctx.session.broadcast && ctx.from.id.toString() === ADMIN_ID) {
    ctx.session.broadcast = false
    try {
      const res = await axios.get(`${FIREBASE_DB_URL}/users.json`)
      const users = res.data || {}
      for (const uid of Object.keys(users)) {
        try {
          await ctx.copyMessage(uid, ctx.chat.id, ctx.message.message_id)
        } catch {}
      }
      await ctx.reply("✅ Broadcast sent to all users.")
    } catch {
      await ctx.reply("❌ Failed to send broadcast.")
    }
  } else {
    await next()
  }
})

bot.on(["document", "video", "photo", "sticker", "animation"], async (ctx) => {
  let file_id, file_name, file_size

  if (ctx.message.document) {
    file_id = ctx.message.document.file_id
    file_name = ctx.message.document.file_name
    file_size = ctx.message.document.file_size
  } else if (ctx.message.video) {
    file_id = ctx.message.video.file_id
    file_name = "video.mp4"
    file_size = ctx.message.video.file_size
  } else if (ctx.message.photo) {
    const photo = ctx.message.photo.at(-1)
    file_id = photo.file_id
    file_name = "image.jpg"
    file_size = photo.file_size
  } else if (ctx.message.sticker) {
    file_id = ctx.message.sticker.file_id
    file_name = "sticker.webp"
    file_size = ctx.message.sticker.file_size
  } else if (ctx.message.animation) {
    file_id = ctx.message.animation.file_id
    file_name = ctx.message.animation.file_name || "animation.gif"
    file_size = ctx.message.animation.file_size
  }

  if (file_size > MAX_SIZE) {
    await ctx.reply("❌ File too large. Only files under 30 MB are allowed.", { reply_to_message_id: ctx.message.message_id })
    return
  }

  const file = await ctx.telegram.getFile(file_id)
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
  const buffer = (await axios.get(url, { responseType: 'arraybuffer' })).data
  const id = randomBytes(8).toString("hex")
  storage[id] = { buffer, name: file_name }
  const link = `${VERCEL_URL}/upload?id=${id}`

  try {
    await axios.post(`${FIREBASE_DB_URL}/links.json`, {
      link,
      name: ctx.from.first_name,
      id: ctx.from.id,
      time: Date.now()
    })
  } catch {}

  await ctx.reply(`🔗 Your file is hosted here:\n${link}`, { reply_to_message_id: ctx.message.message_id })
})

app.get("/webhook", (req, res) => {
  res.json({ status: "Webhook is live ✅" })
})

app.get("/upload", (req, res) => {
  const file = storage[req.query.id]
  if (!file) return res.status(404).send("File not found")
  res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`)
  res.send(file.buffer)
})

export default app
