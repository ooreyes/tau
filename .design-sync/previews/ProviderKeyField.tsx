import { ProviderKeyField } from '@tau/desktop';

const noop = () => {};


/** No key saved yet — the field is open with the prefix as a paste check. */
export function Empty() {
  return (
    <div style={{ width: 460 }}>
      <ProviderKeyField
        id="anthropic-key"
        label="Anthropic API key"
        keyPrefix="sk-ant-"
        hasKey={false}
        onSave={noop}
        onNotice={noop}
      />
    </div>
  );
}

/** A key is stored — the field collapses to a replace affordance. */
export function Saved() {
  return (
    <div style={{ width: 460 }}>
      <ProviderKeyField
        id="anthropic-key-saved"
        label="Anthropic API key"
        keyPrefix="sk-ant-"
        hasKey
        onSave={noop}
        onNotice={noop}
      />
    </div>
  );
}
