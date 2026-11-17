import { MANDATORY_EMAIL_CATEGORIES, NOTIFICATION_CATEGORIES } from './templates.js';

/**
 * In-app notification centre and per-category channel preferences.
 * Notifications are written by `messaging.queue` in the same transaction as the
 * event, so the list never shows something that did not happen.
 */
export function createNotificationsService({ prisma }) {
  const serialize = (n) => ({
    id: n.id,
    category: n.category,
    title: n.title,
    body: n.body,
    link: n.link,
    read: Boolean(n.readAt),
    createdAt: n.createdAt,
  });

  return {
    async list(userId, { unreadOnly = false, page = 1, pageSize = 20 } = {}) {
      const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };
      const [total, unread, rows] = await prisma.$transaction([
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { userId, readAt: null } }),
        prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { data: rows.map(serialize), meta: { page, pageSize, total, unread } };
    },

    async unreadCount(userId) {
      return prisma.notification.count({ where: { userId, readAt: null } });
    },

    /** Marks the given notifications (only the caller's own) as read. Returns how many changed. */
    async markRead(userId, ids) {
      const { count } = await prisma.notification.updateMany({
        where: { userId, id: { in: ids }, readAt: null },
        data: { readAt: new Date() },
      });
      return count;
    },

    async markAllRead(userId) {
      const { count } = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
      return count;
    },

    async preferences(userId) {
      const rows = await prisma.notificationPreference.findMany({ where: { userId } });
      const byCategory = Object.fromEntries(rows.map((r) => [r.category, r]));
      return NOTIFICATION_CATEGORIES.map((category) => {
        const r = byCategory[category];
        const emailLocked = MANDATORY_EMAIL_CATEGORIES.has(category);
        return {
          category,
          email: emailLocked ? true : (r?.email ?? true),
          sms: r?.sms ?? false,
          inApp: r?.inApp ?? true,
          emailLocked,
        };
      });
    },

    /** Saves the given categories. Email for security and account categories stays on regardless. */
    async updatePreferences(userId, items) {
      await prisma.$transaction(
        items.map(({ category, email, sms, inApp }) => {
          const data = { email: MANDATORY_EMAIL_CATEGORIES.has(category) ? true : email, sms, inApp };
          return prisma.notificationPreference.upsert({
            where: { userId_category: { userId, category } },
            create: { userId, category, ...data },
            update: data,
          });
        }),
      );
      return this.preferences(userId);
    },
  };
}
