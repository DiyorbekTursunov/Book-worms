import dotenv from 'dotenv';

dotenv.config();

if (!process.env.BOT_TOKEN || !process.env.GROUP_ID) {
  throw new Error('BOT_TOKEN yoki GROUP_ID .env faylida topilmadi');
}

export const config = {
  botToken: process.env.BOT_TOKEN,
  groupId: process.env.GROUP_ID,
  adminIds: ['1802639780'] // Adminlarning Telegram IDlari (o'zingiznikini qo'shing)
};
