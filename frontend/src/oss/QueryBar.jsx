import { useState } from 'react';
import { completions } from './query';

// The reference, has(…) or keyword being typed before the cursor.
const wordAt = (text, cursor) => text.slice(0, cursor).match(/[\w.#(]*$/)[0];

/**
 * The query formula bar: a text input with completions for objective and
 * field names, and the parse error (if any) marked under the text. It is the
 * last item of the page header, on a row of its own.
 */
export default function QueryBar({ model, value, onChange, error, inputRef, matched, total }) {
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const [pick, setPick] = useState(0);
  const word = wordAt(value, cursor);
  const options = focused ? completions(model, word) : [];

  const accept = (option) => {
    const start = cursor - word.length;
    const text = value.slice(0, start) + option + ' ' + value.slice(cursor);
    const at = start + option.length + 1;
    onChange(text);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(at, at));
    setCursor(at);
  };

  const onKeyDown = (e) => {
    if (!options.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      accept(options[Math.min(pick, options.length - 1)]);
    } else if (e.key === 'Escape') {
      setFocused(false);
    }
  };

  const track = (e) => {
    setCursor(e.target.selectionStart ?? e.target.value.length);
    setPick(0);
  };

  return (
    <div className="oss-query">
      <div className="oss-query-row">
        <span className="oss-fx mono">ƒx</span>
        <div className="oss-query-box">
          <input
            ref={inputRef}
            className="mono"
            value={value}
            spellCheck={false}
            placeholder="Click objectives, fields and values, or type e.g. has(LobbyBLJ) and keys = 0"
            onChange={(e) => {
              onChange(e.target.value);
              track(e);
            }}
            onSelect={track}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          {error && (
            <div className="oss-caret mono" aria-hidden>
              <span>{value.slice(0, error.pos)}</span>^
            </div>
          )}
          {options.length > 0 && (
            <ul className="oss-complete mono">
              {options.map((o, i) => (
                <li key={o} className={i === pick ? 'sel' : undefined} onMouseDown={(e) => {
                    e.preventDefault();
                    accept(o);
                  }}
                >
                  {o}
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="stat oss-matched">
          matched <b>{typeof matched === 'number' ? matched.toLocaleString() : matched}</b> of {total.toLocaleString()} loaded
        </span>
      </div>
      {error && <div className="bad small oss-error">{error.message}</div>}
    </div>
  );
}
