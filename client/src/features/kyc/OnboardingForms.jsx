import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/index.js';
import { api, applyServerErrors } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { COUNTRIES, EMPLOYMENT, EXPERIENCE, GH_REGIONS, ID_TYPES, INCOME_BANDS, OBJECTIVES, SOURCES, options } from './labels.js';

export const ONBOARDING_KEY = ['onboarding'];

/** Shared save logic: PUT the section, refresh the overview, map field errors. */
function useSection(section, form, onSaved) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (values) => api.put(`/onboarding/${section}`, values),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ONBOARDING_KEY });
      toast.success('Saved');
      onSaved?.();
    },
    onError: (err) => applyServerErrors(err, form.setError) || toast.error('Could not save', err.message),
  });
}

function CheckboxGroup({ legend, map, value = [], onChange, error }) {
  const toggle = (key) => onChange(value.includes(key) ? value.filter((v) => v !== key) : [...value, key]);
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {Object.entries(map).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-muted">
            <input type="checkbox" className="size-4 accent-brand-600" checked={value.includes(key)} onChange={() => toggle(key)} />
            {label}
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function Actions({ pending, disabled }) {
  if (disabled) return null;
  return (
    <div className="flex justify-end">
      <Button type="submit" loading={pending}>
        Save and continue
      </Button>
    </div>
  );
}

const countryOptions = options(COUNTRIES);
const req = (msg = 'Required') => z.string().trim().min(1, msg);

export function PersonalForm({ profile, disabled, onSaved }) {
  const form = useForm({
    resolver: zodResolver(
      z.object({
        dateOfBirth: req('Enter your date of birth'),
        nationality: req(),
        idType: req('Choose a document type'),
        idNumber: req('Enter the document number'),
        idExpiryDate: req('Enter the expiry date'),
        idIssuingCountry: req(),
      }),
    ),
    defaultValues: {
      dateOfBirth: profile.dateOfBirth ?? '',
      nationality: profile.nationality ?? 'GH',
      idType: profile.idType ?? '',
      // The stored number is never sent back. It must be re-entered to change it.
      idNumber: '',
      idExpiryDate: profile.idExpiryDate ?? '',
      idIssuingCountry: profile.idIssuingCountry ?? 'GH',
    },
  });
  const save = useSection('personal', form, onSaved);
  const e = form.formState.errors;
  const idType = form.watch('idType');
  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <fieldset disabled={disabled} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date of birth" error={e.dateOfBirth?.message} required>
            {(p) => <Input type="date" autoComplete="bday" {...p} {...form.register('dateOfBirth')} />}
          </Field>
          <Field label="Nationality" error={e.nationality?.message} required>
            {(p) => <Select options={countryOptions} {...p} {...form.register('nationality')} />}
          </Field>
          <Field label="Identity document" error={e.idType?.message} required>
            {(p) => <Select placeholder="Select…" options={options(ID_TYPES)} {...p} {...form.register('idType')} />}
          </Field>
          <Field
            label="Document number"
            hint={
              profile.idNumberMasked
                ? `Saved: ${profile.idNumberMasked}. Re-enter to update.`
                : idType === 'GHANA_CARD'
                  ? 'Format: GHA-123456789-0'
                  : undefined
            }
            error={e.idNumber?.message}
            required
          >
            {(p) => <Input autoComplete="off" className="uppercase" {...p} {...form.register('idNumber')} />}
          </Field>
          <Field label="Expiry date" error={e.idExpiryDate?.message} required>
            {(p) => <Input type="date" {...p} {...form.register('idExpiryDate')} />}
          </Field>
          <Field label="Issuing country" error={e.idIssuingCountry?.message} required>
            {(p) => <Select options={countryOptions} {...p} {...form.register('idIssuingCountry')} />}
          </Field>
        </div>
        <Actions pending={save.isPending} disabled={disabled} />
      </fieldset>
    </form>
  );
}

export function AddressForm({ profile, disabled, onSaved }) {
  const form = useForm({
    resolver: zodResolver(
      z.object({
        addressLine1: z.string().trim().min(3, 'Enter your street address'),
        addressLine2: z.string().optional(),
        city: req('Enter your town or city'),
        region: req('Choose your region'),
        postalCode: z.string().optional(),
        addressCountry: req(),
      }),
    ),
    defaultValues: {
      addressLine1: profile.addressLine1 ?? '',
      addressLine2: profile.addressLine2 ?? '',
      city: profile.city ?? '',
      region: profile.region ?? '',
      postalCode: profile.postalCode ?? '',
      addressCountry: profile.addressCountry ?? 'GH',
    },
  });
  const save = useSection('address', form, onSaved);
  const e = form.formState.errors;
  const country = form.watch('addressCountry');
  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <fieldset disabled={disabled} className="space-y-4">
        <Field label="Street address" error={e.addressLine1?.message} required>
          {(p) => <Input autoComplete="address-line1" {...p} {...form.register('addressLine1')} />}
        </Field>
        <Field label="Apartment, suite or landmark (optional)">
          {(p) => <Input autoComplete="address-line2" {...p} {...form.register('addressLine2')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Town or city" error={e.city?.message} required>
            {(p) => <Input autoComplete="address-level2" {...p} {...form.register('city')} />}
          </Field>
          <Field label="Region" error={e.region?.message} required>
            {(p) =>
              country === 'GH' ? (
                <Select
                  placeholder="Select…"
                  options={GH_REGIONS.map((r) => ({ value: r, label: r }))}
                  {...p}
                  {...form.register('region')}
                />
              ) : (
                <Input autoComplete="address-level1" {...p} {...form.register('region')} />
              )
            }
          </Field>
          <Field label="Digital address or postcode (optional)" hint="e.g. GA-123-4567">
            {(p) => <Input autoComplete="postal-code" className="uppercase" {...p} {...form.register('postalCode')} />}
          </Field>
          <Field label="Country" error={e.addressCountry?.message} required>
            {(p) => <Select options={countryOptions} {...p} {...form.register('addressCountry')} />}
          </Field>
        </div>
        <Actions pending={save.isPending} disabled={disabled} />
      </fieldset>
    </form>
  );
}

export function FinancialForm({ profile, disabled, onSaved }) {
  const form = useForm({
    resolver: zodResolver(
      z.object({
        employmentStatus: req('Choose your employment status'),
        occupation: z.string().optional(),
        employerName: z.string().optional(),
        annualIncomeBand: req('Choose an income range'),
        sourceOfFunds: z.array(z.string()).min(1, 'Choose at least one source'),
        sourceOfFundsDetails: z.string().optional(),
      }),
    ),
    defaultValues: {
      employmentStatus: profile.employmentStatus ?? '',
      occupation: profile.occupation ?? '',
      employerName: profile.employerName ?? '',
      annualIncomeBand: profile.annualIncomeBand ?? '',
      sourceOfFunds: profile.sourceOfFunds ?? [],
      sourceOfFundsDetails: profile.sourceOfFundsDetails ?? '',
    },
  });
  const save = useSection('financial', form, onSaved);
  const e = form.formState.errors;
  const employed = ['EMPLOYED', 'SELF_EMPLOYED'].includes(form.watch('employmentStatus'));
  const other = form.watch('sourceOfFunds').includes('OTHER');
  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <fieldset disabled={disabled} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Employment status" error={e.employmentStatus?.message} required>
            {(p) => <Select placeholder="Select…" options={options(EMPLOYMENT)} {...p} {...form.register('employmentStatus')} />}
          </Field>
          <Field label="Annual income" error={e.annualIncomeBand?.message} required>
            {(p) => <Select placeholder="Select…" options={options(INCOME_BANDS)} {...p} {...form.register('annualIncomeBand')} />}
          </Field>
          {employed && (
            <>
              <Field label="Occupation" error={e.occupation?.message} required>
                {(p) => <Input autoComplete="organization-title" {...p} {...form.register('occupation')} />}
              </Field>
              <Field label="Employer or business name">
                {(p) => <Input autoComplete="organization" {...p} {...form.register('employerName')} />}
              </Field>
            </>
          )}
        </div>
        <Controller
          control={form.control}
          name="sourceOfFunds"
          render={({ field }) => (
            <CheckboxGroup
              legend="Where does the money you will invest come from?"
              map={SOURCES}
              value={field.value}
              onChange={field.onChange}
              error={e.sourceOfFunds?.message}
            />
          )}
        />
        {other && (
          <Field label="Describe the other source" error={e.sourceOfFundsDetails?.message} required>
            {(p) => <Textarea {...p} {...form.register('sourceOfFundsDetails')} />}
          </Field>
        )}
        <Actions pending={save.isPending} disabled={disabled} />
      </fieldset>
    </form>
  );
}

export function InvestmentForm({ profile, disabled, onSaved }) {
  const form = useForm({
    resolver: zodResolver(
      z.object({
        investmentObjectives: z.array(z.string()).min(1, 'Choose at least one objective'),
        investmentExperience: req('Choose your experience'),
      }),
    ),
    defaultValues: { investmentObjectives: profile.investmentObjectives ?? [], investmentExperience: profile.investmentExperience ?? '' },
  });
  const save = useSection('investment', form, onSaved);
  const e = form.formState.errors;
  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <fieldset disabled={disabled} className="space-y-4">
        <Controller
          control={form.control}
          name="investmentObjectives"
          render={({ field }) => (
            <CheckboxGroup
              legend="What are you investing for?"
              map={OBJECTIVES}
              value={field.value}
              onChange={field.onChange}
              error={e.investmentObjectives?.message}
            />
          )}
        />
        <Field label="Investment experience" error={e.investmentExperience?.message} required className="max-w-sm">
          {(p) => <Select placeholder="Select…" options={options(EXPERIENCE)} {...p} {...form.register('investmentExperience')} />}
        </Field>
        <Actions pending={save.isPending} disabled={disabled} />
      </fieldset>
    </form>
  );
}

export function InstitutionForm({ profile, disabled, onSaved }) {
  const form = useForm({
    resolver: zodResolver(
      z.object({
        registrationNumber: z.string().trim().min(3, 'Enter the registration number'),
        incorporationDate: req('Enter the date'),
        incorporationCountry: req(),
      }),
    ),
    defaultValues: {
      registrationNumber: profile.registrationNumber ?? '',
      incorporationDate: profile.incorporationDate ?? '',
      incorporationCountry: profile.incorporationCountry ?? 'GH',
    },
  });
  const save = useSection('institution', form, onSaved);
  const e = form.formState.errors;
  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <fieldset disabled={disabled} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Registration number" error={e.registrationNumber?.message} required>
            {(p) => <Input className="uppercase" {...p} {...form.register('registrationNumber')} />}
          </Field>
          <Field label="Date of incorporation" error={e.incorporationDate?.message} required>
            {(p) => <Input type="date" {...p} {...form.register('incorporationDate')} />}
          </Field>
          <Field label="Country of incorporation" error={e.incorporationCountry?.message} required>
            {(p) => <Select options={countryOptions} {...p} {...form.register('incorporationCountry')} />}
          </Field>
        </div>
        <Actions pending={save.isPending} disabled={disabled} />
      </fieldset>
    </form>
  );
}

export function DeclarationsForm({ profile, disabled, onSaved }) {
  const form = useForm({
    resolver: zodResolver(
      z.object({
        isPoliticallyExposed: z.enum(['yes', 'no'], { error: 'Answer this question' }),
        pepDetails: z.string().optional(),
        taxResidency: req(),
        accept: z.literal(true, { error: 'Confirm to continue' }),
      }),
    ),
    defaultValues: {
      isPoliticallyExposed: profile.isPoliticallyExposed === null ? undefined : profile.isPoliticallyExposed ? 'yes' : 'no',
      pepDetails: profile.pepDetails ?? '',
      taxResidency: profile.taxResidency ?? 'GH',
      accept: profile.declarationsAccepted || false,
    },
  });
  const save = useSection('declarations', form, onSaved);
  const e = form.formState.errors;
  const pep = form.watch('isPoliticallyExposed') === 'yes';
  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate({ ...v, isPoliticallyExposed: v.isPoliticallyExposed === 'yes' }))}>
      <fieldset disabled={disabled} className="space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-ink">
            Do you, a family member or a close associate hold (or have held in the last 12 months) a prominent public position?
          </legend>
          <p className="mt-0.5 text-xs text-ink-subtle">
            For example: government minister, MP, senior judge, ambassador, senior military officer or head of a state-owned company.
          </p>
          <div className="mt-2 flex gap-4 text-sm">
            {['no', 'yes'].map((v) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" value={v} className="size-4 accent-brand-600" {...form.register('isPoliticallyExposed')} />
                {v === 'yes' ? 'Yes' : 'No'}
              </label>
            ))}
          </div>
          {e.isPoliticallyExposed && (
            <p role="alert" className="mt-1 text-xs font-medium text-danger">
              {e.isPoliticallyExposed.message}
            </p>
          )}
        </fieldset>
        {pep && (
          <Field label="Describe the position and your relationship to the person" error={e.pepDetails?.message} required>
            {(p) => <Textarea {...p} {...form.register('pepDetails')} />}
          </Field>
        )}
        <Field label="Country of tax residence" error={e.taxResidency?.message} required className="max-w-sm">
          {(p) => <Select options={countryOptions} {...p} {...form.register('taxResidency')} />}
        </Field>
        <label className="flex items-start gap-3 text-sm text-ink-muted">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" {...form.register('accept')} />
          <span>I confirm the information I have provided is true and complete, and I will tell Mynx promptly if it changes.</span>
        </label>
        {e.accept && (
          <p role="alert" className="-mt-2 text-xs font-medium text-danger">
            {e.accept.message}
          </p>
        )}
        <Actions pending={save.isPending} disabled={disabled} />
      </fieldset>
    </form>
  );
}
