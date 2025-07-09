import express from "express"
import cors from "cors"
import { PrismaClient } from "@prisma/client"
import { BotService } from "./service/botService"

const prisma = new PrismaClient()
const app = express()

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static("public")) // index.html ni public papkasidan xizmat qilish uchun

// API Endpointlari
app.get("/api/tasks", async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      orderBy: { scheduledDate: "desc" },
    })
    res.json(tasks)
  } catch (error) {
    res.status(500).json({ error: "Vazifalarni olishda xatolik" })
  }
})

app.post("/api/tasks", async (req, res) => {
  try {
    const { description, scheduledDate } = req.body
    const selectedDate = new Date(scheduledDate)
    selectedDate.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Faqat o'tgan kun uchun vazifa qo'shishni cheklash (bugungi kun ruxsat etilgan)
    if (selectedDate < today) {
      return res.status(400).json({ error: "Vazifa o'tgan kun uchun qo'shilmaydi" })
    }

    // Bir kunga bitta vazifa cheklovi
    const existingTask = await prisma.task.findFirst({
      where: {
        scheduledDate: {
          gte: selectedDate,
          lt: new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    })

    if (existingTask) {
      return res.status(400).json({ error: "Bu sanaga allaqachon vazifa qo'shilgan" })
    }

    const task = await prisma.task.create({
      data: {
        description,
        scheduledDate: new Date(scheduledDate),
      },
    })

    // Barcha mavjud foydalanuvchilar uchun TaskCompletion yaratish
    const users = await prisma.user.findMany()
    for (const user of users) {
      await prisma.taskCompletion.create({
        data: {
          userId: user.id,
          taskId: task.id,
          completed: false,
          penaltyPaid: false,
        },
      })
    }

    // Vazifani kanalga yuborish
    await BotService.sendTaskToChannel(task)

    res.json(task)
  } catch (error) {
    console.error("Vazifa yaratishda xatolik:", error)
    res.status(500).json({ error: "Vazifa yaratishda xatolik" })
  }
})

app.put("/api/tasks/:id", async (req, res) => {
  try {
    const taskId = Number.parseInt(req.params.id)
    const { description, scheduledDate } = req.body
    const selectedDate = new Date(scheduledDate)
    selectedDate.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Faqat o'tgan kun uchun vazifa tahrirlanmasligi kerak (bugungi kun ruxsat etilgan)
    if (selectedDate < today) {
      return res.status(400).json({ error: "Vazifa o'tgan kun uchun tahrirlanmaydi" })
    }

    // Bir kunga bitta vazifa cheklovi (joriy vazifadan tashqari)
    const existingTask = await prisma.task.findFirst({
      where: {
        id: { not: taskId },
        scheduledDate: {
          gte: selectedDate,
          lt: new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    })

    if (existingTask) {
      return res.status(400).json({ error: "Bu sanaga allaqachon boshqa vazifa qo'shilgan" })
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        description,
        scheduledDate: new Date(scheduledDate),
      },
    })

    // Vazifa yangilanishini kanalga yuborish
    await BotService.sendTaskUpdateToChannel(task)

    res.json(task)
  } catch (error) {
    console.error("Vazifani tahrirlashda xatolik:", error)
    res.status(500).json({ error: "Vazifani tahrirlashda xatolik" })
  }
})

app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const taskId = Number.parseInt(req.params.id)

    // Vazifani olish (o'chirishdan oldin kanalga xabar yuborish uchun)
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    })

    if (!task) {
      return res.status(404).json({ error: "Vazifa topilmadi" })
    }

    // Vazifani o'chirish (TaskCompletion lar ham avtomatik o'chiriladi)
    await prisma.task.delete({ where: { id: taskId } })

    // Vazifa o'chirilishini kanalga yuborish
    await BotService.sendTaskDeletionToChannel(task)

    res.json({ success: true })
  } catch (error) {
    console.error("Vazifani o'chirishda xatolik:", error)
    res.status(500).json({ error: "Vazifani o'chirishda xatolik" })
  }
})

app.get("/api/users", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: { tasks: { include: { task: true } } },
    })
    res.json(users)
  } catch (error) {
    res.status(500).json({ error: "Foydalanuvchilarni olishda xatolik" })
  }
})

app.post("/api/users/:id/mark-payment", async (req, res) => {
  try {
    const userId = Number.parseInt(req.params.id)
    await prisma.taskCompletion.updateMany({
      where: { userId, completed: false, penaltyPaid: false },
      data: { penaltyPaid: true },
    })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: "To'lovni belgilashda xatolik" })
  }
})

app.delete("/api/users/:id", async (req, res) => {
  try {
    const userId = Number.parseInt(req.params.id)
    await prisma.user.delete({ where: { id: userId } })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: "Foydalanuvchini o'chirishda xatolik" })
  }
})

// Botni ishga tushirish
BotService.start()

// Serverni ishga tushirish
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server ${PORT} portida ishlamoqda`))
