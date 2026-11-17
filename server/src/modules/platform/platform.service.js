/**
 * Public platform metadata: operating mode and enabled currencies.
 * The client shows the sandbox banner from this response and never decides the mode on its own.
 */
export function createPlatformService({ prisma, mode, settings = null }) {
  return {
    async info() {
      const currencies = await prisma.currency.findMany({
        where: { isActive: true },
        orderBy: { code: 'asc' },
        select: { code: true, name: true, symbol: true, minorUnits: true },
      });
      return {
        name: 'Mynx',
        apiVersion: 'v1',
        mode,
        realMoneyEnabled: mode === 'live',
        disclosure:
          mode === 'sandbox'
            ? 'Sandbox environment: all balances, payments and investments are simulated and have no monetary value.'
            : 'Investments carry risk. The value of investments can go down as well as up, and past performance does not guarantee future results.',
        currencies,
        // Set by administrators through the approval workflow.
        announcement: settings ? (await settings.get('platform.announcement')) || null : null,
        maintenance: settings ? Boolean(await settings.get('platform.maintenance_mode')) : false,
      };
    },
  };
}
