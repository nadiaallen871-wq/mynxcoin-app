import { SETTINGS, SETTINGS_BY_KEY } from './settings.registry.js';

const CACHE_MS = 15_000;

/**
 * Reads system settings with a short in-process cache. Writes happen only through an
 * approved ApprovalRequest (see approvals.service.js), which calls `apply` and then
 * `invalidate`. Precedence: an approved value stored in the database, then the deployment
 * default from the environment (`defaults`), then the registry default.
 */
export function createSettingsService({ prisma, defaults = {} }) {
  const fallback = (d) => defaults[d.key] ?? d.default;
  let cache = null;
  let loadedAt = 0;

  async function load() {
    if (cache && Date.now() - loadedAt < CACHE_MS) return cache;
    const rows = await prisma.systemSetting.findMany();
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    cache = Object.fromEntries(SETTINGS.map((d) => [d.key, byKey[d.key]?.value ?? fallback(d)]));
    cache.__rows = byKey;
    loadedAt = Date.now();
    return cache;
  }

  return {
    async get(key) {
      if (!SETTINGS_BY_KEY[key]) throw new Error(`Unknown setting ${key}`);
      return (await load())[key];
    },

    async values() {
      const { __rows, ...values } = await load();
      return values;
    },

    /** Settings with their definitions, for the admin console. Sensitive values are shown only as on/off. */
    async list() {
      const all = await load();
      return SETTINGS.map((d) => {
        const row = all.__rows[d.key];
        return {
          key: d.key,
          group: d.group,
          type: d.type,
          description: d.description,
          editable: d.editable !== false,
          sensitive: Boolean(d.sensitive),
          min: d.min ?? null,
          max: d.max ?? null,
          maxLength: d.maxLength ?? null,
          value: all[d.key],
          default: fallback(d),
          overridden: Boolean(row),
          version: row?.version ?? 0,
          // Only changes applied through an approval have an author; seeded rows do not count as changes.
          updatedAt: row?.updatedById ? row.updatedAt : null,
        };
      });
    },

    /** Applies a validated value inside the approval transaction, with optimistic version check. */
    async apply(tx, key, value, { expectedVersion, actorId }) {
      const def = SETTINGS_BY_KEY[key];
      const current = await tx.systemSetting.findUnique({ where: { key } });
      if ((current?.version ?? 0) !== expectedVersion) return { conflict: true };
      if (current) {
        await tx.systemSetting.update({ where: { key }, data: { value, version: { increment: 1 }, updatedById: actorId } });
      } else {
        await tx.systemSetting.create({
          data: { key, value, description: def.description, isSensitive: Boolean(def.sensitive), updatedById: actorId },
        });
      }
      return { conflict: false, before: current?.value ?? fallback(def) };
    },

    invalidate() {
      cache = null;
    },
  };
}
