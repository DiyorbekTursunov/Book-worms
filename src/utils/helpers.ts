import { Context } from 'telegraf';
import { config } from '../config';

export async function isAdmin(ctx: Context): Promise<boolean> {
  try {
    if (!ctx.from) {
      return false;
    }
    return config.adminIds.includes(ctx.from.id.toString());
  } catch (error) {
    console.error('Admin holatini tekshirishda xatolik:', error);
    return false;
  }
}
