import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { isFoodTag, normaliseCategory, suggestCategories } from "../lib/categories";
import { cx } from "./ui";

/**
 * A list of category tags, edited as chips with autocomplete.
 *
 * Only the program's food categories (FOOD_TAGS) can be added: no food
 * carries any other tag, so anything else could never match. Enter adds the
 * highlighted suggestion; comma or leaving the box adds what has been typed
 * if it names a category; pasting a comma-separated list adds each one that
 * does. A value saved before the list was fixed is kept, but flagged.
 */
export default function CategoryInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  // Highlighted suggestion. The first one is highlighted as soon as anything
  // is typed, so Enter completes a partial name.
  const [active, setActive] = useState(-1);

  const suggestions = useMemo(
    () => suggestCategories(text, values),
    [text, values],
  );

  useEffect(() => setActive(text.trim() ? 0 : -1), [text]);

  const add = (raw: string[]) => {
    const next = [...values];
    for (const r of raw) {
      const v = normaliseCategory(r);
      if (isFoodTag(v) && !next.includes(v)) next.push(v);
    }
    if (next.length !== values.length) onChange(next);
    setText("");
  };

  const remove = (v: string) => onChange(values.filter((x) => x !== v));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const showing = open && suggestions.length > 0;
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? suggestions.length : i) - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showing && suggestions[active]) add([suggestions[active]]);
      else if (text.trim()) add([text]);
    } else if (e.key === ",") {
      e.preventDefault();
      if (text.trim()) add([text]);
    } else if (e.key === "Backspace" && !text && values.length) {
      remove(values[values.length - 1]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.includes(",")) return;
    e.preventDefault();
    add(pasted.split(","));
  };

  const showList = open && suggestions.length > 0;

  return (
    <div className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className={cx(
          "flex min-h-11 w-full cursor-text flex-wrap items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2 py-1.5 transition-colors",
          "focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30",
          "dark:border-slate-700 dark:bg-slate-900",
        )}
      >
        {values.map((v) => (
          <span
            key={v}
            title={isFoodTag(v) ? undefined : "Not a food category: no food carries this tag, so it never matches"}
            className={cx(
              "inline-flex max-w-full items-center gap-0.5 rounded-lg py-0.5 pr-0.5 pl-2 text-sm",
              isFoodTag(v)
                ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                : "bg-amber-100 text-amber-900 line-through dark:bg-amber-950 dark:text-amber-200",
            )}
          >
            <span className="truncate">{v}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(v);
              }}
              aria-label={`Remove ${v}`}
              className="tap grid size-6 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:text-slate-100"
            >
              <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            if (text.trim()) add([text]);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={values.length ? "Add another…" : placeholder}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && active >= 0 ? `${listId}-${active}` : undefined
          }
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="min-w-28 flex-1 border-0 bg-transparent px-1 py-1 text-slate-900 placeholder:text-slate-400 focus:ring-0 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {!text.trim() && (
            <li className="px-3 pt-1 pb-1.5 text-xs text-slate-500 dark:text-slate-400" role="presentation">
              Food categories
            </li>
          )}
          {suggestions.map((tag, i) => (
            <li
              key={tag}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keep focus in the input so the click is not also a blur.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add([tag])}
              onMouseEnter={() => setActive(i)}
              className={cx(
                "cursor-pointer truncate px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100",
                i === active && "bg-brand-50 dark:bg-brand-950",
              )}
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
      {open && text.trim() && suggestions.length === 0 && (
        <p className="absolute inset-x-0 top-full z-30 mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No food category matches “{text.trim()}”.
        </p>
      )}
    </div>
  );
}
