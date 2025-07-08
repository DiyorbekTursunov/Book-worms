import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import { config } from './config';
import { generateGroupStatistics } from './utils/chartGenerator';

const prisma = new PrismaClient();

export function setupCron(bot: Telegraf) {
  // Post daily task at 6:00 AM Tashkent time
  cron.schedule('0 6 * * *', async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const task = await prisma.task.findFirst({
        where: {
          scheduledDate: {
            gte: today,
            lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
          }
        }
      });

      if (task) {
        await bot.telegram.sendMessage(config.groupId, `Bugungi vazifa: ${task.description} 📚`);
      } else {
        await bot.telegram.sendMessage(config.groupId, 'Bugun uchun vazifa topilmadi.');
      }
    } catch (error) {
      console.error('Kunlik vazifa cronida xatolik:', error);
    }
  }, { timezone: 'Asia/Tashkent' });

  // Notify admins at 8:00 PM if no task for tomorrow
  cron.schedule('0 20 * * *', async () => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const task = await prisma.task.findFirst({
        where: {
          scheduledDate: {
            gte: tomorrow,
            lt: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
          }
        }
      });

      if (!task) {
        for (const adminId of config.adminIds) {
          await bot.telegram.sendMessage(adminId, "Ertaga uchun vazifa topilmadi! Iltimos, /add_task buyrug‘i bilan vazifa qo‘shing.");
        }
      }
    } catch (error) {
      console.error('Ertaga vazifa eslatma cronida xatolik:', error);
    }
  }, { timezone: 'Asia/Tashkent' });

  // Send reminder at 9:00 PM Tashkent time
  cron.schedule('0 21 * * *', async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const task = await prisma.task.findFirst({
        where: {
          scheduledDate: {
            gte: today,
            lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
          }
        }
      });

      if (task) {
        await bot.telegram.sendMessage(config.groupId, 'Eslatma: Bugungi vazifani yarim tungacha bajaring! ⏰');
      }
    } catch (error) {
      console.error('Eslatma cronida xatolik:', error);
    }
  }, { timezone: 'Asia/Tashkent' });

  // Impose penalties at 11:59 PM Tashkent time
  cron.schedule('59 23 * * *', async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const task = await prisma.task.findFirst({
        where: {
          scheduledDate: {
            gte: today,
            lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
          }
        }
      });

      if (task) { // Only apply penalties if a task exists
        const users = await prisma.user.findMany();
        for (const user of users) {
          const completion = await prisma.taskCompletion.findFirst({
            where: { userId: user.id, taskId: task.id }
          });
          if (!completion) {
            await prisma.taskCompletion.create({
              data: {
                userId: user.id,
                taskId: task.id,
                completed: false,
                penaltyPaid: false
              }
            });
            await prisma.user.update({
              where: { id: user.id },
              data: { currentStreak: 0 }
            });
          }
        }
      }
    } catch (error) {
      console.error('Jarima cronida xatolik:', error);
    }
  }, { timezone: 'Asia/Tashkent' });

  // Send daily statistics at 6:00 AM Tashkent time
  cron.schedule('0 6 * * *', async () => {
    try {
      const image = await generateGroupStatistics();
      await bot.telegram.sendPhoto(config.groupId, { source: image }, { caption: 'Kunlik statistika 📊' });
    } catch (error) {
      console.error('Statistika cronida xatolik:', error);
    }
  }, { timezone: 'Asia/Tashkent' });

  // Check unpaid penalties and kick users at midnight
  cron.schedule('0 0 * * *', async () => {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const unpaidUsers = await prisma.user.findMany({
        where: {
          tasks: {
            some: {
              completed: false,
              penaltyPaid: false,
              task: { scheduledDate: { lt: sevenDaysAgo } }
            }
          }
        }
      });

      for (const user of unpaidUsers) {
        try {
          await bot.telegram.banChatMember(config.groupId, parseInt(user.telegramId));
          await bot.telegram.sendMessage(config.groupId, `${user.name} to‘lanmagan jarimalar tufayli guruhdan chiqarildi.`);
        } catch (error) {
          console.error(`${user.name} ni chiqarishda xatolik:`, error);
        }
      }
    } catch (error) {
      console.error('Chiqarish cronida xatolik:', error);
    }
  }, { timezone: 'Asia/Tashkent' });
}
