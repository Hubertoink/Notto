import { FolderOpen, X, PenLine, Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { Action } from './components';
import { TagLabel } from './Bauhaus';
import { tagsOf } from './domain';
import { normalizeCollections } from './note-tools';

export function documentTags(value: string): string[] {
  return tagsOf(
    value
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
      .join(' '),
  );
}

export function DocumentLabels({
  kind,
  values,
  onChange,
  input,
  onInput,
  known,
  disabled,
}: {
  kind: 'tags' | 'collections';
  values: string[];
  onChange: (values: string[]) => void;
  input: string;
  onInput: (input: string) => void;
  known: string[];
  disabled: boolean;
}) {
  const tags = kind === 'tags';
  const label = tags ? 'Tags' : 'Sammlungen';
  const [editing, setEditing] = useState(false);
  const normalize = (names: string[]) => (tags ? documentTags(names.join(' ')) : normalizeCollections(names));
  const suggestions = known
    .filter(
      (name) =>
        !values.some((value) => value.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')) &&
        name.toLocaleLowerCase('de').includes(input.trim().replace(/^#/, '').toLocaleLowerCase('de')),
    )
    .slice(0, 8);
  function add(value: string) {
    const names = tags
      ? documentTags(value)
      : value.split(',').map((name) => {
          const trimmed = name.trim();
          return (
            known.find((existing) => existing.toLocaleLowerCase('de') === trimmed.toLocaleLowerCase('de')) ||
            trimmed
          );
        });
    onChange(normalize([...values, ...names]));
    onInput('');
  }
  return (
    <div className="document-labels">
      <div className="document-label-heading">
        <span id={`document-${kind}-label`}>{label}</span>
        <Action
          label={editing ? `${label}-Bearbeitung schließen` : `${label} bearbeiten`}
          tooltip={editing ? `${label}-Bearbeitung schließen` : `${label} bearbeiten`}
          icon={editing ? <Check size={16} /> : <PenLine size={16} />}
          isIconOnly
          variant="ghost"
          size="sm"
          isDisabled={disabled}
          aria-expanded={editing}
          aria-controls={`document-${kind}-editor`}
          onClick={() => {
            if (editing && input.trim()) add(input);
            setEditing(!editing);
          }}
        />
      </div>
      <div className={tags ? 'editor-tags document-label-chips' : 'note-collections document-label-chips'}>
        {values.map((value) => (
          <span key={value} className={tags ? 'tag' : 'collection-chip'}>
            {tags ? (
              <TagLabel name={value} />
            ) : (
              <>
                <FolderOpen size={13} /> {value}
              </>
            )}
            {editing && (
              <button
                type="button"
                disabled={disabled}
                aria-label={`${tags ? 'Tag' : 'Sammlung'} ${value} entfernen`}
                onClick={() => onChange(values.filter((name) => name !== value))}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!values.length && <span className="muted small">{tags ? 'Keine Tags' : 'Keine Sammlungen'}</span>}
      {editing && (
        <div className="document-label-editor" id={`document-${kind}-editor`}>
          <div className="document-label-input">
            <input
              id={`document-${kind}`}
              aria-labelledby={`document-${kind}-label`}
              autoFocus
              value={input}
              disabled={disabled || (!tags && values.length >= 30)}
              placeholder={tags ? '#Tag hinzufügen …' : 'Sammlung suchen oder anlegen …'}
              maxLength={tags ? 300 : 60}
              onChange={(event) => {
                const value = event.target.value;
                if ((tags && /[\s,]$/.test(value)) || (!tags && value.endsWith(','))) add(value);
                else onInput(value);
              }}
              onKeyDown={(event) => {
                if (!event.nativeEvent.isComposing && ['Enter', 'Tab'].includes(event.key) && input.trim()) {
                  event.preventDefault();
                  add(input);
                }
              }}
            />
            <Action
              isDisabled={disabled || !input.trim() || (!tags && values.length >= 30)}
              label={`${tags ? 'Tag' : 'Sammlung'} hinzufügen`}
              tooltip={`${tags ? 'Tag' : 'Sammlung'} hinzufügen`}
              icon={<Plus size={18} />}
              isIconOnly
              variant="ghost"
              onClick={() => add(input)}
            />
          </div>
          {!!suggestions.length && (
            <div
              className="document-label-suggestions"
              aria-label={tags ? 'Vorhandene Tags' : 'Vorhandene Sammlungen'}
            >
              {suggestions.map((name) => (
                <button
                  type="button"
                  key={name}
                  disabled={disabled || (!tags && values.length >= 30)}
                  onClick={() => add(name)}
                >
                  {tags ? (
                    <TagLabel name={name} />
                  ) : (
                    <>
                      <FolderOpen size={13} /> {name}
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
          <small className="muted">
            {tags
              ? 'Wie bei Notizen: #Tags hinzufügen oder vorhandene auswählen.'
              : 'Ein Dokument kann in mehreren Sammlungen liegen.'}
          </small>
        </div>
      )}
    </div>
  );
}
