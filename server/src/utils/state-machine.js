import { ConflictError } from './errors.js';

/**
 * Minimal finite-state machine for financial records. Transitions are declared
 * explicitly, and anything else is rejected. Services call `assertTransition` and
 * then update with a conditional `WHERE status = from`, so concurrent requests
 * cannot both move the same record.
 */
export function defineStateMachine(name, transitions) {
  const states = new Set([...Object.keys(transitions), ...Object.values(transitions).flat()]);
  const terminal = [...states].filter((s) => !(transitions[s]?.length > 0));
  return Object.freeze({
    name,
    states: [...states],
    terminal,
    can: (from, to) => Boolean(transitions[from]?.includes(to)),
    next: (from) => [...(transitions[from] ?? [])],
    assertTransition(from, to) {
      if (!states.has(from) || !states.has(to)) throw new Error(`${name}: unknown state ${!states.has(from) ? from : to}`);
      if (!transitions[from]?.includes(to)) {
        throw new ConflictError(`${name} cannot move from ${from} to ${to}`, 'INVALID_STATE_TRANSITION');
      }
    },
  });
}

/** Payment-backed records used from Phase 6. Declared here so the flows are reviewed with the ledger design. */
export const DepositStates = defineStateMachine('Deposit', {
  INITIATED: ['PENDING', 'FAILED', 'CANCELLED'],
  PENDING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: ['REVERSED'],
  FAILED: [],
  CANCELLED: [],
  REVERSED: [],
});

export const WithdrawalStates = defineStateMachine('Withdrawal', {
  REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PROCESSING'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  FAILED: ['PROCESSING', 'RETURNED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
  RETURNED: [],
});

/** Investment order lifecycle (as specified for the investment engine). */
export const InvestmentOrderStates = defineStateMachine('Investment order', {
  DRAFT: ['PENDING', 'CANCELLED'],
  PENDING: ['AWAITING_PAYMENT', 'PROCESSING', 'CANCELLED', 'REJECTED'],
  AWAITING_PAYMENT: ['PROCESSING', 'CANCELLED', 'FAILED'],
  PROCESSING: ['CONFIRMED', 'REJECTED', 'FAILED'],
  CONFIRMED: ['ACTIVE'],
  ACTIVE: ['PARTIALLY_REDEEMED', 'REDEMPTION_PENDING', 'MATURED'],
  PARTIALLY_REDEEMED: ['REDEMPTION_PENDING', 'MATURED'],
  REDEMPTION_PENDING: ['PARTIALLY_REDEEMED', 'MATURED', 'ACTIVE'],
  MATURED: [],
  CANCELLED: [],
  REJECTED: [],
  FAILED: [],
});
