import { Telegraf } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import { CronJob } from 'cron';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { generateStreakImage, generateStatisticsImage, generateGroupStatistics } from '../utils/chartGenerator';
import * as Chart from 'chart.js/auto'; // Use 'auto' for automatic adapter registration
import * as dotenv from 'dotenv';

// Define ChatMember type manually based on Telegram Bot API
interface ChatMember {
  user: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  status: string;
  // Add other fields as needed (e.g., custom_title, is_anonymous, etc.)
}

dotenv.config();

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN || '');
const groupId = process.env.GROUP_ID || '';

export class BotService {
  static async start() {
    // Handle /start command with chat type check
    bot.command('start', async (ctx) => {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const chatMember = await ctx.telegram.getChatMember(groupId, parseInt(userId));
      const isAdmin = ['administrator', 'creator'].includes(chatMember.status);
      const isPrivateChat = ctx.chat?.type === 'private';

      if (isAdmin) {
        if (isPrivateChat) {
          // Send web app button in private chat
          await ctx.reply('Admin panelini ochish', {
            reply_markup: {
              keyboard: [[
                {
                  text: 'Admin panelini ochish',
                  web_app: { url: 'https://your-domain.com/index.html' } // Replace with your actual domain
                }
              ]],
              resize_keyboard: true
            }
          });
        } else {
          // Send URL link in group chat
          await ctx.reply('Admin paneli: https://your-domain.com/index.html', {
            reply_markup: { remove_keyboard: true }
          });
        }
      } else {
        await ctx.reply('Xush kelibsiz Book Worms ga! Vazifalarni belgilash uchun /vazifa dan foydalaning.');
      }
    });

    // Handle /vazifa command for users
    bot.command('vazifa', async (ctx) => {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const user = await prisma.user.findUnique({
        where: { telegramId: userId },
        include: { tasks: { include: { task: true } } }
      });

      if (!user) {
        await ctx.reply('Siz ro‘yxatdan o‘tmagansiz. Iltimos, admin bilan bog‘laning.');
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const task = await prisma.task.findFirst({
        where: {
          scheduledDate: {
            gte: today,
            lt: tomorrow
          }
        }
      });

      if (!task) {
        await ctx.reply('Bugun uchun vazifa mavjud emas.');
        return;
      }

      const taskCompletion = await prisma.taskCompletion.findUnique({
        where: { userId_taskId: { userId: user.id, taskId: task.id } }
      });

      if (taskCompletion && !taskCompletion.completed) {
        await prisma.taskCompletion.update({
          where: { userId_taskId: { userId: user.id, taskId: task.id } },
          data: { completed: true }
        });

        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const prevTask = await prisma.task.findFirst({
          where: { scheduledDate: { gte: yesterday, lt: today } }
        });
        const prevCompletion = prevTask ? await prisma.taskCompletion.findUnique({
          where: { userId_taskId: { userId: user.id, taskId: prevTask.id } }
        }) : null;

        let newStreak = user.currentStreak;
        if (prevCompletion && !prevCompletion.completed) {
          newStreak = 0; // Reset streak if previous task was missed
        } else if (taskCompletion.completed) {
          newStreak += 1; // Increment streak
        }
        await prisma.user.update({
          where: { id: user.id },
          data: { currentStreak: newStreak }
        });

        const streakImage = await generateStreakImage(user);
        await ctx.replyWithPhoto({ source: streakImage }, { caption: `Qabul qilindi! Sizning davomiyligingiz: ${newStreak} kun` });
      } else {
        await ctx.reply('Siz bu vazifani allaqachon belgiladingiz yoki bugun vazifa yo‘q.');
      }
    });

    bot.command('user_status', async (ctx) => {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const user = await prisma.user.findUnique({
        where: { telegramId: userId },
        include: { tasks: { include: { task: true } } }
      });

      if (!user) {
        await ctx.reply('Siz ro‘yxatdan o‘tmagansiz. Iltimos, admin bilan bog‘laning.');
        return;
      }

      const statsImage = await generateStatisticsImage(user);
      await ctx.replyWithPhoto({ source: statsImage });
    });

    bot.command('stats', async (ctx) => {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const chatMember = await ctx.telegram.getChatMember(groupId, parseInt(userId));
      if (!['administrator', 'creator'].includes(chatMember.status)) {
        await ctx.reply('Faqat adminlar statistikani ko‘ra oladi.');
        return;
      }

      const groupStatsImage = await generateGroupStatistics();
      await ctx.replyWithPhoto({ source: groupStatsImage }, { caption: 'Umumiy Statistika' });
    });

    // Daily task announcement (Vazifalar category) at 06:00
    new CronJob('0 0 6 * * *', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const task = await prisma.task.findFirst({
        where: {
          scheduledDate: {
            gte: today,
            lt: tomorrow
          }
        }
      });

      if (task) {
        await bot.telegram.sendMessage(groupId, `📋 <b>Vazifalar</b>\nBugungi vazifa: ${task.description}`, { parse_mode: 'HTML' });
      }
    }, null, true, 'Asia/Tashkent');

    // Daily fond statistics (Fond category) at 06:00
    new CronJob('0 0 6 * * *', async () => {
      const groupStatsImage = await generateGroupStatistics();
      await bot.telegram.sendPhoto(groupId, { source: groupStatsImage }, {
        caption: '💰 <b>Fond (Ehson)</b>\nUmumiy Statistika',
        parse_mode: 'HTML'
      });
    }, null, true, 'Asia/Tashkent');

    // Daily reminder at 21:00
    new CronJob('0 0 21 * * *', async () => {
      const users = await prisma.user.findMany({
        include: { tasks: { include: { task: true } } }
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const task = await prisma.task.findFirst({
        where: {
          scheduledDate: {
            gte: today,
            lt: tomorrow
          }
        }
      });

      if (task) {
        for (const user of users) {
          const pendingTask = user.tasks.find(t => t.taskId === task.id && !t.completed);
          if (pendingTask) {
            await bot.telegram.sendMessage(user.telegramId, '/vazifa belgiladingizmi?');
          }
        }
      }
    }, null, true, 'Asia/Tashkent');

    // Notify admin at 21:00 if no task for tomorrow
    new CronJob('0 0 21 * * *', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const task = await prisma.task.findFirst({
        where: {
          scheduledDate: {
            gte: tomorrow,
            lt: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
          }
        }
      });

      if (!task) {
        const admins = await bot.telegram.getChatAdministrators(groupId);
        const adminIds = admins.map((admin) => admin.user.id.toString());
        const adminUsers = await prisma.user.findMany({
          where: { telegramId: { in: adminIds } }
        });
        for (const admin of adminUsers) {
          await bot.telegram.sendMessage(admin.telegramId, 'Eslatma: Ertaga uchun vazifa yaratilmagan. Iltimos, admin panelida yangi vazifa qo‘shing!');
        }
      }
    }, null, true, 'Asia/Tashkent');

    bot.catch((err, ctx) => {
      console.error(`Xato ${ctx.updateType} uchun:`, err);
      ctx.reply('Xatolik yuz berdi. Iltimos, keyinroq qayta urining.');
    });

    bot.launch();
  }
}
