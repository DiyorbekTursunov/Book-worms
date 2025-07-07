import express, { Request, Response } from 'express';
import { Telegraf, Context } from 'telegraf';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const bot = new Telegraf(BOT_TOKEN);

bot.command('vazifa', async (ctx: Context) => {
  const telegramId = ctx.from?.id.toString() || '';
  const name = `${ctx.from?.first_name ?? ''} ${ctx.from?.last_name ?? ''}`.trim();

  const user = await prisma.user.upsert({
    where: { telegramId },
    update: { name },
    create: { telegramId, name }
  });

  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  await prisma.task.upsert({
    where: { userId_date: { userId: user.id, date } },
    update: { completed: true },
    create: { userId: user.id, date, completed: true }
  });

  await ctx.reply('Vazifa qabul qilindi');
});

const app = express();
app.use(express.json());

app.post('/webhook', (req: Request, res: Response) => {
  bot.handleUpdate(req.body as any);
  res.sendStatus(200);
});

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
