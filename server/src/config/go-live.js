/**
 * Startup gate for live (real-money) mode. Live mode runs only when the
 * `platform.go_live_approved` system setting is true. That setting cannot be changed from the
 * admin console: it is set by an operator after every go-live prerequisite in
 * documentation/production-readiness.md is signed off, and the change is audited.
 * Sandbox mode is unaffected.
 */
export async function assertGoLiveApproved({ env, prisma, logger }) {
  if (env.PLATFORM_MODE !== 'live') return;
  const row = await prisma.systemSetting.findUnique({ where: { key: 'platform.go_live_approved' } });
  if (row?.value !== true) {
    logger.fatal('PLATFORM_MODE=live but platform.go_live_approved is not true. Refusing to start.');
    throw new Error('Live mode is not approved (platform.go_live_approved)');
  }
  logger.warn('LIVE MODE: real-money operations are enabled');
}
