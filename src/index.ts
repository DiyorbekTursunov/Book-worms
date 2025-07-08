import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { BotService } from './service/botService';

const prisma = new PrismaClient();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // index.html ni public papkasidan xizmat qilish uchun

// API Endpointlar
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      orderBy: { scheduledDate: 'desc' }
    });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Vazifalarni olishda xatolik' });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { description, scheduledDate } = req.body;
    const selectedDate = new Date(scheduledDate);
    selectedDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Bugungi yoki o‘tgan kun uchun vazifa qo‘shishni cheklash
    if (selectedDate <= today) {
      return res.status(400).json({ error: 'Vazifa bugungi yoki o‘tgan kun uchun qo‘shilmaydi' });
    }

    // Bir kunga bitta vazifa cheklovi
    const existingTask = await prisma.task.findFirst({
      where: {
        scheduledDate: {
          gte: selectedDate,
          lt: new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000)
        }
      }
    });

    if (existingTask) {
      return res.status(400).json({ error: 'Bu sanaga allaqachon vazifa qo‘shilgan' });
    }

    const task = await prisma.task.create({
      data: {
        description,
        scheduledDate: new Date(scheduledDate)
      }
    });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Vazifa yaratishda xatolik' });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { description, scheduledDate } = req.body;
    const selectedDate = new Date(scheduledDate);
    selectedDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Bugungi yoki o‘tgan kun uchun vazifa tahrirlanmasligi kerak
    if (selectedDate <= today) {
      return res.status(400).json({ error: 'Vazifa bugungi yoki o‘tgan kun uchun tahrirlanmaydi' });
    }

    // Bir kunga bitta vazifa cheklovi (joriy vazifadan tashqari)
    const existingTask = await prisma.task.findFirst({
      where: {
        id: { not: taskId },
        scheduledDate: {
          gte: selectedDate,
          lt: new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000)
        }
      }
    });

    if (existingTask) {
      return res.status(400).json({ error: 'Bu sanaga allaqachon boshqa vazifa qo‘shilgan' });
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        description,
        scheduledDate: new Date(scheduledDate)
      }
    });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Vazifani tahrirlashda xatolik' });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    await prisma.task.delete({ where: { id: taskId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Vazifani o‘chirishda xatolik' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: { tasks: { include: { task: true } } }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Foydalanuvchilarni olishda xatolik' });
  }
});

app.post('/api/users/:id/mark-payment', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    await prisma.taskCompletion.updateMany({
      where: { userId, completed: false, penaltyPaid: false },
      data: { penaltyPaid: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'To‘lovni belgilashda xatolik' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    await prisma.user.delete({ where: { id: userId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Foydalanuvchini o‘chirishda xatolik' });
  }
});

// Botni ishga tushirish
BotService.start();

// Serverni ishga tushirish
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ${PORT} portida ishlamoqda`));
