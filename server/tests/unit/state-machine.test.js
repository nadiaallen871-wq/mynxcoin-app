import { describe, expect, it } from 'vitest';
import { DepositStates, InvestmentOrderStates, WithdrawalStates, defineStateMachine } from '../../src/utils/state-machine.js';

describe('state machines', () => {
  const m = defineStateMachine('Thing', { A: ['B'], B: ['C', 'A'], C: [] });

  it('allows declared transitions only', () => {
    expect(m.can('A', 'B')).toBe(true);
    expect(m.can('A', 'C')).toBe(false);
    expect(() => m.assertTransition('A', 'B')).not.toThrow();
    expect(() => m.assertTransition('A', 'C')).toThrow(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION', status: 409 }));
    expect(() => m.assertTransition('A', 'Z')).toThrow(/unknown state/);
    expect(m.terminal).toEqual(['C']);
  });

  it('defines the specified investment order states', () => {
    expect(InvestmentOrderStates.states.sort()).toEqual(
      [
        'ACTIVE',
        'AWAITING_PAYMENT',
        'CANCELLED',
        'CONFIRMED',
        'DRAFT',
        'FAILED',
        'MATURED',
        'PARTIALLY_REDEEMED',
        'PENDING',
        'PROCESSING',
        'REDEMPTION_PENDING',
        'REJECTED',
      ].sort(),
    );
    expect(InvestmentOrderStates.can('CONFIRMED', 'CANCELLED')).toBe(false);
    expect(InvestmentOrderStates.terminal.sort()).toEqual(['CANCELLED', 'FAILED', 'MATURED', 'REJECTED']);
  });

  it('never lets a completed payment flow move backwards', () => {
    expect(DepositStates.can('SUCCEEDED', 'PENDING')).toBe(false);
    expect(WithdrawalStates.can('COMPLETED', 'PROCESSING')).toBe(false);
    expect(WithdrawalStates.can('REQUESTED', 'PROCESSING')).toBe(false); // approval is mandatory
  });
});
