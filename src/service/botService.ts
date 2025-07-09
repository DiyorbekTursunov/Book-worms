import { Telegraf } from "telegraf"
import { PrismaClient } from "@prisma/client"
import { CronJob } from "cron"
import { generateStreakImage, generateStatisticsImage, generateGroupStatistics } from "../utils/chartGenerator"
import * as dotenv from "dotenv"

// Define ChatMember type manually based on Telegram Bot API
interface ChatMember {
  user: {
    id: number
    is_bot: boolean
    first_name: string
    last_name?: string
    username?: string
  }
  status: string
}

dotenv.config()

const prisma = new PrismaClient()
const bot = new Telegraf(process.env.BOT_TOKEN || "")
const groupId = process.env.GROUP_ID || ""

export class BotService {
  // Check if user is a member of the group
  static async isUserGroupMember(userId: number): Promise<boolean> {
    try {
      const chatMember = await bot.telegram.getChatMember(groupId, userId)
      // User is considered a member if they are not kicked, banned, or left
      return !["kicked", "left", "banned"].includes(chatMember.status)
    } catch (error) {
      console.error("Error checking user membership:", error)
      return false
    }
  }

  // Sync users with group members
  static async syncGroupMembers() {
    try {
      // Get all users from database
      const dbUsers = await prisma.user.findMany()

      for (const user of dbUsers) {
        const isGroupMember = await this.isUserGroupMember(Number.parseInt(user.telegramId))

        if (!isGroupMember) {
          // User is no longer in group, you can either:
          // 1. Delete the user
          await prisma.user.delete({
            where: { id: user.id },
          })

          // OR 2. Mark user as inactive (add isActive field to schema)
          // await prisma.user.update({
          //   where: { id: user.id },
          //   data: { isActive: false }
          // });

          console.log(`Removed user ${user.name} (${user.telegramId}) - no longer in group`)
        }
      }
    } catch (error) {
      console.error("Error syncing group members:", error)
    }
  }

  // Add new group members to database
  static async addNewGroupMember(userId: string, name: string) {
    try {
      const existingUser = await prisma.user.findUnique({
        where: { telegramId: userId },
      })

      if (!existingUser) {
        await prisma.user.create({
          data: {
            telegramId: userId,
            name: name,
          },
        })
        console.log(`Added new user: ${name} (${userId})`)
      }
    } catch (error) {
      console.error("Error adding new user:", error)
    }
  }

  static async start() {
    // Handle new chat members
    bot.on("new_chat_members", async (ctx) => {
      const newMembers = ctx.message.new_chat_members

      for (const member of newMembers) {
        if (!member.is_bot) {
          const name = member.first_name + (member.last_name ? ` ${member.last_name}` : "")
          await this.addNewGroupMember(member.id.toString(), name)

          // Welcome message
          await ctx.reply(
            `Xush kelibsiz, ${name}! Book Worms guruhiga qo'shildingiz. Vazifalarni belgilash uchun /vazifa dan foydalaning.`,
          )
        }
      }
    })

    // Handle members leaving
    bot.on("left_chat_member", async (ctx) => {
      const leftMember = ctx.message.left_chat_member

      if (!leftMember.is_bot) {
        try {
          await prisma.user.delete({
            where: { telegramId: leftMember.id.toString() },
          })
          console.log(`Removed user ${leftMember.first_name} (${leftMember.id}) - left group`)
        } catch (error) {
          console.error("Error removing user:", error)
        }
      }
    })

    // Handle /start command with user validation
    bot.command("start", async (ctx) => {
      const userId = ctx.from?.id?.toString()
      if (!userId) return

      // Check if user is still in group
      const isGroupMember = await this.isUserGroupMember(Number.parseInt(userId))
      if (!isGroupMember) {
        await ctx.reply("Siz guruh a'zosi emassiz. Iltimos, avval guruhga qo'shiling.")
        return
      }

      const chatMember = await ctx.telegram.getChatMember(groupId, Number.parseInt(userId))
      const isAdmin = ["administrator", "creator"].includes(chatMember.status)
      const isPrivateChat = ctx.chat?.type === "private"

      if (isAdmin) {
        if (isPrivateChat) {
          await ctx.reply("Admin panelini ochish", {
            reply_markup: {
              keyboard: [
                [
                  {
                    text: "Admin panelini ochish",
                    web_app: { url: "https://book-worms-webapp.vercel.app" },
                  },
                ],
              ],
              resize_keyboard: true,
            },
          })
        } else {
          await ctx.reply("Admin paneli: https://book-worms-webapp.vercel.app", {
            reply_markup: { remove_keyboard: true },
          })
        }
      } else {
        // Add user to database if not exists
        const name = ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : "")
        await this.addNewGroupMember(userId, name)

        await ctx.reply("Xush kelibsiz Book Worms ga! Vazifalarni belgilash uchun /vazifa dan foydalaning.")
      }
    })

    // Handle /vazifa command with user validation
    bot.command("vazifa", async (ctx) => {
      const userId = ctx.from?.id?.toString()
      if (!userId) return

      // Check if user is still in group
      const isGroupMember = await this.isUserGroupMember(Number.parseInt(userId))
      if (!isGroupMember) {
        await ctx.reply("Siz guruh a'zosi emassiz. Botdan foydalana olmaysiz.")
        return
      }

      const user = await prisma.user.findUnique({
        where: { telegramId: userId },
        include: { tasks: { include: { task: true } } },
      })

      if (!user) {
        // Auto-add user if they're in group but not in database
        const name = ctx.from?.first_name + (ctx.from?.last_name ? ` ${ctx.from.last_name}` : "")
        await this.addNewGroupMember(userId, name || "Unknown")
        await ctx.reply("Siz ro'yxatga qo'shildingiz. Iltimos, qaytadan /vazifa buyrug'ini yuboring.")
        return
      }

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(today.getDate() + 1)

      const task = await prisma.task.findFirst({
        where: {
          scheduledDate: {
            gte: today,
            lt: tomorrow,
          },
        },
      })

      if (!task) {
        await ctx.reply("Bugun uchun vazifa mavjud emas.")
        return
      }

      const taskCompletion = await prisma.taskCompletion.findUnique({
        where: { userId_taskId: { userId: user.id, taskId: task.id } },
      })

      if (taskCompletion && !taskCompletion.completed) {
        await prisma.taskCompletion.update({
          where: { userId_taskId: { userId: user.id, taskId: task.id } },
          data: { completed: true },
        })

        const yesterday = new Date(today)
        yesterday.setDate(today.getDate() - 1)

        const prevTask = await prisma.task.findFirst({
          where: { scheduledDate: { gte: yesterday, lt: today } },
        })

        const prevCompletion = prevTask
          ? await prisma.taskCompletion.findUnique({
              where: { userId_taskId: { userId: user.id, taskId: prevTask.id } },
            })
          : null

        let newStreak = user.currentStreak
        if (prevCompletion && !prevCompletion.completed) {
          newStreak = 0
        } else if (taskCompletion.completed) {
          newStreak += 1
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { currentStreak: newStreak },
        })

        const streakImage = await generateStreakImage(user)
        await ctx.replyWithPhoto(
          { source: streakImage },
          {
            caption: `Qabul qilindi! Sizning davomiyligingiz: ${newStreak} kun`,
          },
        )
      } else {
        await ctx.reply("Siz bu vazifani allaqachon belgiladingiz yoki bugun vazifa yo'q.")
      }
    })

    // Handle /user_status command with user validation
    bot.command("user_status", async (ctx) => {
      const userId = ctx.from?.id?.toString()
      if (!userId) return

      // Check if user is still in group
      const isGroupMember = await this.isUserGroupMember(Number.parseInt(userId))
      if (!isGroupMember) {
        await ctx.reply("Siz guruh a'zosi emassiz. Botdan foydalana olmaysiz.")
        return
      }

      const user = await prisma.user.findUnique({
        where: { telegramId: userId },
        include: { tasks: { include: { task: true } } },
      })

      if (!user) {
        await ctx.reply("Siz ro'yxatdan o'tmagansiz. Iltimos, /start buyrug'ini yuboring.")
        return
      }

      const statsImage = await generateStatisticsImage(user)
      await ctx.replyWithPhoto({ source: statsImage })
    })

    // Handle /stats command with admin validation
    bot.command("stats", async (ctx) => {
      const userId = ctx.from?.id?.toString()
      if (!userId) return

      // Check if user is still in group
      const isGroupMember = await this.isUserGroupMember(Number.parseInt(userId))
      if (!isGroupMember) {
        await ctx.reply("Siz guruh a'zosi emassiz. Botdan foydalana olmaysiz.")
        return
      }

      const chatMember = await ctx.telegram.getChatMember(groupId, Number.parseInt(userId))
      if (!["administrator", "creator"].includes(chatMember.status)) {
        await ctx.reply("Faqat adminlar statistikani ko'ra oladi.")
        return
      }

      const groupStatsImage = await generateGroupStatistics()
      await ctx.replyWithPhoto({ source: groupStatsImage }, { caption: "Umumiy Statistika" })
    })

    // Admin command to sync group members
    bot.command("sync_users", async (ctx) => {
      const userId = ctx.from?.id?.toString()
      if (!userId) return

      const chatMember = await ctx.telegram.getChatMember(groupId, Number.parseInt(userId))
      if (!["administrator", "creator"].includes(chatMember.status)) {
        await ctx.reply("Faqat adminlar bu buyruqni ishlatishi mumkin.")
        return
      }

      await ctx.reply("Foydalanuvchilar sinxronlanmoqda...")
      await this.syncGroupMembers()
      await ctx.reply("Foydalanuvchilar muvaffaqiyatli sinxronlandi!")
    })

    // Daily task announcement at 06:00
    new CronJob(
      "0 0 6 * * *",
      async () => {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today)
        tomorrow.setDate(today.getDate() + 1)

        const task = await prisma.task.findFirst({
          where: {
            scheduledDate: {
              gte: today,
              lt: tomorrow,
            },
          },
        })

        if (task) {
          await bot.telegram.sendMessage(groupId, `📋 <b>Vazifalar</b>\nBugungi vazifa: ${task.description}`, {
            parse_mode: "HTML",
          })
        }
      },
      null,
      true,
      "Asia/Tashkent",
    )

    // Daily fond statistics at 06:00
    new CronJob(
      "0 0 6 * * *",
      async () => {
        const groupStatsImage = await generateGroupStatistics()
        await bot.telegram.sendPhoto(
          groupId,
          { source: groupStatsImage },
          {
            caption: "💰 <b>Fond (Ehson)</b>\nUmumiy Statistika",
            parse_mode: "HTML",
          },
        )
      },
      null,
      true,
      "Asia/Tashkent",
    )

    // Daily reminder at 21:00
    new CronJob(
      "0 0 21 * * *",
      async () => {
        const users = await prisma.user.findMany({
          include: { tasks: { include: { task: true } } },
        })

        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today)
        tomorrow.setDate(today.getDate() + 1)

        const task = await prisma.task.findFirst({
          where: {
            scheduledDate: {
              gte: today,
              lt: tomorrow,
            },
          },
        })

        if (task) {
          for (const user of users) {
            // Check if user is still in group before sending reminder
            const isGroupMember = await this.isUserGroupMember(Number.parseInt(user.telegramId))
            if (!isGroupMember) {
              // Remove user from database if not in group
              await prisma.user.delete({ where: { id: user.id } })
              continue
            }

            const pendingTask = user.tasks.find((t) => t.taskId === task.id && !t.completed)
            if (pendingTask) {
              try {
                await bot.telegram.sendMessage(user.telegramId, "/vazifa belgiladingizmi?")
              } catch (error) {
                console.error(`Failed to send reminder to user ${user.telegramId}:`, error)
              }
            }
          }
        }
      },
      null,
      true,
      "Asia/Tashkent",
    )

    // Notify admin at 21:00 if no task for tomorrow
    new CronJob(
      "0 0 21 * * *",
      async () => {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today)
        tomorrow.setDate(today.getDate() + 1)

        const task = await prisma.task.findFirst({
          where: {
            scheduledDate: {
              gte: tomorrow,
              lt: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000),
            },
          },
        })

        if (!task) {
          const admins = await bot.telegram.getChatAdministrators(groupId)
          const adminIds = admins.map((admin) => admin.user.id.toString())

          const adminUsers = await prisma.user.findMany({
            where: { telegramId: { in: adminIds } },
          })

          for (const admin of adminUsers) {
            try {
              await bot.telegram.sendMessage(
                admin.telegramId,
                "Eslatma: Ertaga uchun vazifa yaratilmagan. Iltimos, admin panelida yangi vazifa qo'shing!",
              )
            } catch (error) {
              console.error(`Failed to send admin notification to ${admin.telegramId}:`, error)
            }
          }
        }
      },
      null,
      true,
      "Asia/Tashkent",
    )

    // Sync group members daily at midnight
    new CronJob(
      "0 0 0 * * *",
      async () => {
        await this.syncGroupMembers()
        console.log("Daily user sync completed")
      },
      null,
      true,
      "Asia/Tashkent",
    )

    bot.catch((err, ctx) => {
      console.error(`Xato ${ctx.updateType} uchun:`, err)
      ctx.reply("Xatolik yuz berdi. Iltimos, keyinroq qayta urining.")
    })

    bot.launch()
    console.log("Bot started successfully!")
  }
}
