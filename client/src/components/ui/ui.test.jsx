import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Field, Input, Tabs, DataTable, ConfirmDialog } from './index.js';

describe('Button', () => {
  it('is disabled and busy while loading', () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Field', () => {
  it('associates the label and error with the control', () => {
    render(
      <Field label="Amount" error="Too small">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Amount');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Too small');
  });
});

describe('Tabs', () => {
  it('supports arrow-key navigation', async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        value="a"
        onChange={onChange}
        tabs={[
          { value: 'a', label: 'A', content: 'Panel A' },
          { value: 'b', label: 'B', content: 'Panel B' },
        ]}
      />,
    );
    screen.getByRole('tab', { name: 'A' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel A');
  });
});

describe('DataTable', () => {
  it('renders the empty state when there are no rows', () => {
    render(<DataTable columns={[{ key: 'x', header: 'X' }]} rows={[]} empty={<p>Nothing here</p>} />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('names the action on the confirm button and calls onConfirm', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open title="Cancel order?" confirmLabel="Cancel order" onClose={() => {}} onConfirm={onConfirm}>
        Body
      </ConfirmDialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel order', hidden: true }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
