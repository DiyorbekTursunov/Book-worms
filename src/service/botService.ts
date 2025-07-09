import { Telegraf } from "telegraf"
import { PrismaClient } from "@prisma/client"
import { CronJob } from "cron"
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

interface Task {
  id: number
  description: string
  scheduledDate: Date
  createdAt?: Date
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
      return !["kicked", "left", "banned"].includes(chatMember.status)
    } catch (error) {
      console.error("Error checking user membership:", error)
      return false
    }
  }

  // Calculate user statistics
  static async calculateUserStats(user: any) {
    const completedTasks = user.tasks.filter((t: any) => t.completed).length
    const totalTasks = user.tasks.length
    const missedTasks = totalTasks - completedTasks
    const efficiency = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

    // Calculate membership days
    const membershipDays = Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24))

    return {
      completedTasks,
      totalTasks,
      missedTasks,
      efficiency,
      membershipDays: membershipDays > 0 ? membershipDays : 1,
    }
  }

  // Get user level based on streak (static for now)
  static getUserLevel(streak: number): string {
    if (streak >= 30) return "🏆 Ustoz"
    if (streak >= 20) return "📚 Mutaxassis"
    if (streak >= 10) return "📖 O'quvchi"
    if (streak >= 5) return "📝 Boshlang'ich"
    return "🌱 Yangi boshlovchi"
  }

  // Send task to channel when created
  static async sendTaskToChannel(task: Task) {
    try {
      const taskDate = new Date(task.scheduledDate).toLocaleDateString("uz-UZ", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })

      const message =
        `📋 <b>Yangi Vazifa Qo'shildi!</b>\n\n` +
        `📅 <b>Sana:</b> ${taskDate}\n` +
        `📝 <b>Vazifa:</b> ${task.description}\n\n` +
        `Vazifani belgilash uchun /vazifa buyrug'idan foydalaning!`

      await bot.telegram.sendMessage(groupId, message, {
        parse_mode: "HTML",
      })

      console.log(`Vazifa kanalga yuborildi: ${task.description}`)
    } catch (error) {
      console.error("Vazifani kanalga yuborishda xatolik:", error)
    }
  }

  // Send task update to channel
  static async sendTaskUpdateToChannel(task: Task) {
    try {
      const taskDate = new Date(task.scheduledDate).toLocaleDateString("uz-UZ", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })

      const message =
        `✏️ <b>Vazifa Yangilandi!</b>\n\n` +
        `📅 <b>Sana:</b> ${taskDate}\n` +
        `📝 <b>Yangi Vazifa:</b> ${task.description}\n\n` +
        `Yangilangan vazifani belgilash uchun /vazifa buyrug'idan foydalaning!`

      await bot.telegram.sendMessage(groupId, message, {
        parse_mode: "HTML",
      })

      console.log(`Vazifa yangilanishi kanalga yuborildi: ${task.description}`)
    } catch (error) {
      console.error("Vazifa yangilanishini kanalga yuborishda xatolik:", error)
    }
  }

  // Send task deletion notification to channel
  static async sendTaskDeletionToChannel(task: Task) {
    try {
      const taskDate = new Date(task.scheduledDate).toLocaleDateString("uz-UZ", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })

      const message =
        `🗑️ <b>Vazifa O'chirildi!</b>\n\n` +
        `📅 <b>Sana:</b> ${taskDate}\n` +
        `📝 <b>O'chirilgan Vazifa:</b> ${task.description}`

      await bot.telegram.sendMessage(groupId, message, {
        parse_mode: "HTML",
      })

      console.log(`Vazifa o'chirilishi kanalga yuborildi: ${task.description}`)
    } catch (error) {
      console.error("Vazifa o'chirilishini kanalga yuborishda xatolik:", error)
    }
  }

  // Check and apply penalties for missed tasks
  static async checkAndApplyPenalties() {
    try {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      yesterday.setHours(0, 0, 0, 0)

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      // Find yesterday's task
      const yesterdayTask = await prisma.task.findFirst({
        where: {
          scheduledDate: {
            gte: yesterday,
            lt: today,
          },
        },
      })

      if (!yesterdayTask) return

      // Find all users who didn't complete yesterday's task
      const users = await prisma.user.findMany({
        include: {
          tasks: {
            where: { taskId: yesterdayTask.id },
          },
        },
      })

      for (const user of users) {
        const taskCompletion = user.tasks[0]

        if (!taskCompletion || !taskCompletion.completed) {
          // Reset streak to 0 for users who missed the task
          await prisma.user.update({
            where: { id: user.id },
            data: { currentStreak: 0 },
          })

          // Mark as penalty (unpaid)
          if (taskCompletion) {
            await prisma.taskCompletion.update({
              where: { id: taskCompletion.id },
              data: { penaltyPaid: false },
            })
          }

          console.log(`Applied penalty to user ${user.name} - streak reset to 0`)
        }
      }
    } catch (error) {
      console.error("Error applying penalties:", error)
    }
  }

  // Sync users with group members
  static async syncGroupMembers() {
    try {
      const dbUsers = await prisma.user.findMany()

      for (const user of dbUsers) {
        const isGroupMember = await this.isUserGroupMember(Number.parseInt(user.telegramId))

        if (!isGroupMember) {
          await prisma.user.delete({
            where: { id: user.id },
          })
          console.log(`Removed user ${user.name} (${user.telegramId}) - no longer in group`)
        }
      }
    } catch (error) {
      console.error("Error syncing group members:", error)
    }
  }

  // Add new group members to database and create task completions for existing tasks
  static async addNewGroupMember(userId: string, name: string) {
    try {
      const existingUser = await prisma.user.findUnique({
        where: { telegramId: userId },
      })

      if (!existingUser) {
        const newUser = await prisma.user.create({
          data: {
            telegramId: userId,
            name: name,
            currentStreak: 0,
          },
        })

        // Create task completions for all existing tasks
        const existingTasks = await prisma.task.findMany()

        for (const task of existingTasks) {
          await prisma.taskCompletion.create({
            data: {
              userId: newUser.id,
              taskId: task.id,
              completed: false,
              penaltyPaid: false,
            },
          })
        }

        console.log(`Added new user: ${name} (${userId}) with ${existingTasks.length} task completions`)
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
          await ctx.reply("Admin paneli: https://book-worms-webapp.vercel.app")
        }
      } else {
        const name = ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : "")
        await this.addNewGroupMember(userId, name)

        await ctx.reply("Xush kelibsiz Book Worms ga!", {
          reply_markup: {
            keyboard: [[{ text: "Davomiylik" }, { text: "Statistika" }]],
            resize_keyboard: true,
          },
        })
      }
    })

    // Handle /vazifa command with user validation and streak calculation
    bot.command("vazifa", async (ctx) => {
      const userId = ctx.from?.id?.toString()
      if (!userId) return

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

      if (taskCompletion && taskCompletion.completed) {
        await ctx.reply("Siz bu vazifani allaqachon belgiladingiz!")
        return
      }

      if (taskCompletion) {
        // Mark task as completed
        await prisma.taskCompletion.update({
          where: { userId_taskId: { userId: user.id, taskId: task.id } },
          data: { completed: true },
        })

        // Calculate new streak
        const yesterday = new Date(today)
        yesterday.setDate(today.getDate() - 1)

        const prevTask = await prisma.task.findFirst({
          where: { scheduledDate: { gte: yesterday, lt: today } },
        })

        let newStreak = user.currentStreak + 1

        // Check if user missed yesterday's task
        if (prevTask) {
          const prevCompletion = await prisma.taskCompletion.findUnique({
            where: { userId_taskId: { userId: user.id, taskId: prevTask.id } },
          })

          if (!prevCompletion || !prevCompletion.completed) {
            newStreak = 1 // Reset to 1 if missed yesterday
          }
        }

        // Update user streak
        await prisma.user.update({
          where: { id: user.id },
          data: { currentStreak: newStreak },
        })

        const level = this.getUserLevel(newStreak)

        const message =
          `✅ <b>Vazifa belgilandi!</b>\n\n` +
          `👤 <b>Foydalanuvchi:</b> ${user.name}\n` +
          `🏆 <b>Daraja:</b> ${level}\n` +
          `🔥 <b>Uzluksiz kitob o'qish davomiyligi:</b> ${newStreak} kun\n\n` +
          `Tabriklaymiz! Davom eting! 📚`

        await ctx.reply(message, { parse_mode: "HTML" })
      } else {
        await ctx.reply("Bugun uchun vazifa topilmadi.")
      }
    })

    // Handle "Davomiylik" button
    bot.hears("Davomiylik", async (ctx) => {
      const userId = ctx.from?.id?.toString()
      if (!userId) return

      const isGroupMember = await this.isUserGroupMember(Number.parseInt(userId))
      if (!isGroupMember) {
        await ctx.reply("Siz guruh a'zosi emassiz.")
        return
      }

      const user = await prisma.user.findUnique({
        where: { telegramId: userId },
        include: { tasks: { include: { task: true } } },
      })

      if (!user) {
        await ctx.reply("Siz ro'yxatdan o'tmagansiz. /start buyrug'ini yuboring.")
        return
      }

      const stats = await this.calculateUserStats(user)
      const level = this.getUserLevel(user.currentStreak)

      const message =
        `👤 <b>${user.name}</b>\n\n` +
        `🏆 <b>Daraja:</b> ${level}\n` +
        `🔥 <b>Uzluksiz kitob o'qish davomiyligi:</b> ${user.currentStreak} kun\n` +
        `📅 <b>Guruhga a'zolikning:</b> ${stats.membershipDays} kuni\n` +
        `✅ <b>Jami o'qigan kunlar:</b> ${stats.completedTasks}\n` +
        `❌ <b>Jami qoldirgan kunlar:</b> ${stats.missedTasks}\n` +
        `📊 <b>Mutolaa samaradorligi:</b> ${stats.efficiency}%`

      await ctx.reply(message, { parse_mode: "HTML" })
    })

    // Handle "Statistika" button
    bot.hears("Statistika", async (ctx) => {
      const userId = ctx.from?.id?.toString()
      if (!userId) return

      const isGroupMember = await this.isUserGroupMember(Number.parseInt(userId))
      if (!isGroupMember) {
        await ctx.reply("Siz guruh a'zosi emassiz.")
        return
      }

      const user = await prisma.user.findUnique({
        where: { telegramId: userId },
        include: { tasks: { include: { task: true } } },
      })

      if (!user) {
        await ctx.reply("Siz ro'yxatdan o'tmagansiz. /start buyrug'ini yuboring.")
        return
      }

      const stats = await this.calculateUserStats(user)
      const level = this.getUserLevel(user.currentStreak)

      const message =
        `📊 <b>Statistika</b>\n\n` +
        `👤 <b>Ism familiya:</b> ${user.name}\n` +
        `🏆 <b>Daraja:</b> ${level}\n` +
        `🔥 <b>Uzluksiz kitob o'qish davomiyligi:</b> ${user.currentStreak} kun\n` +
        `📅 <b>Guruhga a'zolikning:</b> ${stats.membershipDays} kuni\n` +
        `✅ <b>Jami o'qigan kunlar:</b> ${stats.completedTasks}\n` +
        `❌ <b>Jami qoldirgan kunlar:</b> ${stats.missedTasks}\n` +
        `📊 <b>Mutolaa samaradorligi:</b> ${stats.efficiency}%`

      await ctx.reply(message, { parse_mode: "HTML" })
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

    // Daily penalty check at 00:01 (1 minute after midnight)
    new CronJob(
      "1 0 0 * * *",
      async () => {
        await this.checkAndApplyPenalties()
        console.log("Daily penalty check completed")
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
            const isGroupMember = await this.isUserGroupMember(Number.parseInt(user.telegramId))
            if (!isGroupMember) {
              await prisma.user.delete({ where: { id: user.id } })
              continue
            }

            const pendingTask = user.tasks.find((t) => t.taskId === task.id && !t.completed)
            if (pendingTask) {
              try {
                await bot.telegram.sendMessage(user.telegramId, "⏰ Eslatma: Bugungi vazifani belgiladingizmi? /vazifa")
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
