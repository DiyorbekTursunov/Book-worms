/*
  Warnings:

  - A unique constraint covering the columns `[userId,taskId]` on the table `TaskCompletion` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "TaskCompletion_userId_taskId_key" ON "TaskCompletion"("userId", "taskId");
