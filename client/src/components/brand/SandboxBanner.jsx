import { FlaskConical, Megaphone, Wrench } from 'lucide-react';
import { usePlatform } from '../../features/platform/usePlatform.js';

/**
 * Persistent banners from the server's platform info:
 *  - sandbox notice whenever the mode is sandbox or unknown (simulated activity must never look like real money)
 *  - maintenance notice when investor money movements are paused
 *  - the administrators' announcement, if one is set (changed only with a second approver)
 */
export function SandboxBanner() {
  const { data, isError } = usePlatform();
  return (
    <>
      {!(data && data.mode === 'live') && (
        <div role="note" className="bg-warning-soft text-warning">
          <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-xs font-medium sm:px-6">
            <FlaskConical className="size-4 shrink-0" aria-hidden="true" />
            <span>
              {isError
                ? 'Platform status unavailable. Treat all activity as simulated.'
                : (data?.disclosure ?? 'Sandbox environment: all balances, payments and investments are simulated.')}
            </span>
          </div>
        </div>
      )}
      {data?.maintenance && (
        <div role="status" className="bg-danger-soft text-danger">
          <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-xs font-medium sm:px-6">
            <Wrench className="size-4 shrink-0" aria-hidden="true" />
            <span>
              Maintenance in progress: deposits, withdrawals and new investments are paused. Your money and investments are not affected.
            </span>
          </div>
        </div>
      )}
      {data?.announcement && (
        <div role="note" className="bg-info-soft text-info">
          <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-xs font-medium sm:px-6">
            <Megaphone className="size-4 shrink-0" aria-hidden="true" />
            <span>{data.announcement}</span>
          </div>
        </div>
      )}
    </>
  );
}
