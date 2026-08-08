/**
 * Layout vocabulary shared by every Settings page, so a new page cannot invent
 * its own spacing. Page → group → row, and nothing else: if a control does not
 * fit a row it is usually two controls.
 */
import type { ReactNode } from "react";

export function SettingsPage({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <section className="tau-settings-page" aria-label={title}>
      <header className="tau-settings-page-head">
        <h1 className="tau-settings-page-title">{title}</h1>
        <p className="tau-settings-page-summary">{summary}</p>
      </header>
      <div className="tau-settings-page-body">{children}</div>
    </section>
  );
}

export function SettingsGroup({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="tau-settings-group">
      <h2 className="tau-settings-group-title">{title}</h2>
      {note && <p className="tau-settings-group-note">{note}</p>}
      <div className="tau-settings-group-body">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  /** Set when the control is a single labelable element. */
  htmlFor?: string;
  children?: ReactNode;
}) {
  const copy = (
    <>
      <span className="tau-settings-row-label">{label}</span>
      {hint && <span className="tau-settings-row-hint">{hint}</span>}
    </>
  );
  return (
    <div className="tau-settings-row">
      {htmlFor ? (
        <label className="tau-settings-row-copy" htmlFor={htmlFor}>
          {copy}
        </label>
      ) : (
        <div className="tau-settings-row-copy">{copy}</div>
      )}
      {children && <div className="tau-settings-row-control">{children}</div>}
    </div>
  );
}

/**
 * A statement the user must not be able to skim past. Used for the
 * payment-responsibility notice, which is the one thing on the Usage page that
 * matters more than any number on it.
 */
export function SettingsNotice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning";
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`tau-settings-notice tone-${tone}`} role="note">
      <span className="tau-settings-notice-lamp" aria-hidden="true" />
      <div className="tau-settings-notice-copy">
        <strong className="tau-settings-notice-title">{title}</strong>
        <div className="tau-settings-notice-body">{children}</div>
      </div>
    </div>
  );
}

/** A number the user reads as data: mono, tabular, unit attached and dimmer. */
export function Readout({
  value,
  unit,
  label,
}: {
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <div className="tau-readout">
      <span className="tau-readout-value">
        {value}
        {unit && <span className="tau-readout-unit">{unit}</span>}
      </span>
      <span className="tau-readout-label">{label}</span>
    </div>
  );
}

/** Segmented radio group. Matches the toolbar's existing segmented control. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="tau-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`tau-segmented-btn${value === option.value ? " active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Checkbox row. Native input: Tau has no Radix checkbox, and a native one is
 *  correct here (it is a real checkbox, not a styled div). */
export function SettingsToggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="tau-settings-row">
      <label className="tau-settings-row-copy" htmlFor={id}>
        <span className="tau-settings-row-label">{label}</span>
        {hint && <span className="tau-settings-row-hint">{hint}</span>}
      </label>
      <div className="tau-settings-row-control">
        <input
          id={id}
          className="tau-settings-checkbox"
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      </div>
    </div>
  );
}
