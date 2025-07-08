
import { Canvas, createCanvas, loadImage } from 'canvas';
import { ChartConfiguration } from 'chart.js';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { PrismaClient, User } from '@prisma/client';

const prisma = new PrismaClient();

export async function generateStreakImage(user: User): Promise<Buffer> {
  const canvas = createCanvas(400, 200);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 400, 200);

  ctx.fillStyle = '#000000';
  ctx.font = '20px Arial';
  ctx.fillText(`Ism: ${user.name}`, 50, 50);
  ctx.fillText(`Daraja: O'quvchi`, 50, 80);
  ctx.fillText(`Davomiylik: ${user.currentStreak} kun`, 50, 110);

  return canvas.toBuffer();
}

export async function generateStatisticsImage(user: User): Promise<Buffer> {
  const joinedAt = user.joinedAt;
  const today = new Date();
  const membershipDays = Math.floor((today.getTime() - joinedAt.getTime()) / (1000 * 60 * 60 * 24));

  const totalDays = await prisma.taskCompletion.count({ where: { userId: user.id } });
  const completedDays = await prisma.taskCompletion.count({
    where: { userId: user.id, completed: true }
  });
  const missedDays = totalDays - completedDays;
  const efficiency = totalDays > 0 ? (completedDays / totalDays) * 100 : 0;

  const pieConfig: ChartConfiguration = {
    type: 'pie',
    data: {
      labels: ['Bajarilgan', 'O‘tkazib yuborilgan'],
      datasets: [{
        data: [completedDays, missedDays],
        backgroundColor: ['#4CAF50', '#F44336']
      }]
    },
    options: { plugins: { title: { display: true, text: 'O‘qish samaradorligi' } } }
  };

  const pieCanvas = new ChartJSNodeCanvas({ width: 300, height: 300 });
  const pieChartImage = await pieCanvas.renderToBuffer(pieConfig);

  const canvas = createCanvas(600, 400);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 600, 400);

  ctx.fillStyle = '#000000';
  ctx.font = '16px Arial';
  ctx.fillText(`Ism: ${user.name}`, 50, 30);
  ctx.fillText(`Daraja: O'quvchi`, 50, 50);
  ctx.fillText(`Davomiylik: ${user.currentStreak} kun`, 50, 70);
  ctx.fillText(`A'zolik kunlari: ${membershipDays}`, 50, 90);
  ctx.fillText(`Bajarilgan kunlar: ${completedDays}`, 50, 110);
  ctx.fillText(`O‘tkazib yuborilgan kunlar: ${missedDays}`, 50, 130);
  ctx.fillText(`Samaradorlik: ${efficiency.toFixed(2)}%`, 50, 150);

  const pieImg = await loadImage(pieChartImage);
  ctx.drawImage(pieImg, 300, 50);

  return canvas.toBuffer();
}

export async function generateGroupStatistics(): Promise<Buffer> {
  const canvas = createCanvas(800, 600);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 800, 600);

  const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const tasks = await prisma.task.findMany({
    where: { scheduledDate: { gte: sevenDaysAgo, lt: today } },
    orderBy: { scheduledDate: 'desc' },
    take: 7
  });

  ctx.fillStyle = '#000000';
  ctx.font = '16px Arial';
  ctx.fillText('Foydalanuvchi', 50, 30);
  for (let i = 0; i < tasks.length; i++) {
    ctx.fillText(tasks[i].scheduledDate.toLocaleDateString(), 150 + i * 60, 30);
  }

  for (let j = 0; j < Math.min(users.length, 10); j++) {
    const user = users[j];
    ctx.fillText(user.name.substring(0, 15), 50, 50 + j * 20);
    for (let i = 0; i < tasks.length; i++) {
      const completion = await prisma.taskCompletion.findFirst({
        where: { userId: user.id, taskId: tasks[i].id }
      });
      ctx.fillStyle = completion?.completed ? '#4CAF50' : (completion?.penaltyPaid ? '#FFEB3B' : '#F44336');
      ctx.fillRect(150 + i * 60, 40 + j * 20, 50, 15);
    }
  }

  const barData = await Promise.all(tasks.map(async (task) => {
    return prisma.taskCompletion.count({ where: { taskId: task.id, completed: true } });
  }));

  const barConfig: ChartConfiguration = {
    type: 'bar',
    data: {
      labels: tasks.map(t => t.scheduledDate.toLocaleDateString()),
      datasets: [{
        label: 'Bajarilgan foydalanuvchilar',
        data: barData,
        backgroundColor: '#4CAF50'
      }]
    },
    options: { scales: { y: { beginAtZero: true } } }
  };

  const chartCanvas = new ChartJSNodeCanvas({ width: 400, height: 200 });
  const barChartImage = await chartCanvas.renderToBuffer(barConfig);
  const barImg = await loadImage(barChartImage);
  ctx.drawImage(barImg, 50, 300);

  const yesterdayTask = tasks[0];
  let incompleteUsers: User[] = [];
  if (yesterdayTask) {
    incompleteUsers = await prisma.user.findMany({
      where: {
        tasks: { some: { taskId: yesterdayTask.id, completed: false } }
      }
    });
  }

  ctx.fillStyle = '#000000';
  ctx.font = '14px Arial';
  ctx.fillText('Kecha bajarilmagan:', 50, 550);
  if (incompleteUsers.length === 0) {
    ctx.fillText('Kecha bajarilmagan vazifalar yo‘q', 50, 570);
  } else {
    incompleteUsers.slice(0, 5).forEach((user, i) => ctx.fillText(user.name, 50, 570 + i * 20));
  }

  const unpaidUsers = await prisma.user.findMany({
    where: {
      tasks: { some: { completed: false, penaltyPaid: false } }
    }
  });
  ctx.fillText('To‘lanmagan jarimalar:', 400, 550);
  if (unpaidUsers.length === 0) {
    ctx.fillText('To‘lanmagan jarimalar yo‘q', 400, 570);
  } else {
    unpaidUsers.slice(0, 5).forEach((user, i) => ctx.fillText(user.name, 400, 570 + i * 20));
  }

  return canvas.toBuffer();
}
