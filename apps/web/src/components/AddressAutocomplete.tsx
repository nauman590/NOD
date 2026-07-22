import { useEffect, useId, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { GOOGLE_MAPS_BROWSER_KEY, mapsEnabled } from "@/lib/maps";

interface Suggestion {
  placeId: string;
  main: string;
  secondary: string;
  full: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: boolean;
  inputClassName: string;
}

// Downtown Atlanta — the launch market. Suggestions are biased here (not restricted, so a
// customer just outside the service area can still be typed in and priced normally).
const ATLANTA = { latitude: 33.749, longitude: -84.388 };
const BIAS_RADIUS_METERS = 40000;
const DEBOUNCE_MS = 300;
const MIN_QUERY = 3;

// Address entry with Google Places suggestions.
//
// Deliberately calls the Places API (New) REST endpoint and renders our own list rather
// than mounting Google's <gmp-place-autocomplete> element: the brief locks the UI, and the
// web component ships its own styling inside a shadow root. This keeps the field visually
// identical to every other input on the page.
//
// Degrades to a plain text input when no Maps key is set, matching how the live map and
// ETA already behave — address entry must never depend on Places being available.
export default function AddressAutocomplete({ value, onChange, placeholder, icon, inputClassName }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Set when the user picks a suggestion, so the resulting value change doesn't
  // immediately trigger a fresh lookup for the text we just filled in.
  const justSelected = useRef(false);

  useEffect(() => {
    if (!mapsEnabled()) return;
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }
    const query = value.trim();
    if (query.length < MIN_QUERY) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    // Debounced: one request per pause in typing, not per keystroke. Places charges per
    // request, so this is a cost control as much as a UX one.
    const cancelled = { current: false };
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GOOGLE_MAPS_BROWSER_KEY },
          body: JSON.stringify({
            input: query,
            includedRegionCodes: ["us"],
            locationBias: { circle: { center: ATLANTA, radius: BIAS_RADIUS_METERS } },
          }),
        });
        if (!res.ok || cancelled.current) return;
        const data = await res.json();
        const next: Suggestion[] = (data.suggestions ?? [])
          .filter((s: any) => s.placePrediction)
          .map((s: any) => ({
            placeId: s.placePrediction.placeId,
            main: s.placePrediction.structuredFormat?.mainText?.text ?? s.placePrediction.text?.text ?? "",
            secondary: s.placePrediction.structuredFormat?.secondaryText?.text ?? "",
            full: s.placePrediction.text?.text ?? "",
          }));
        if (cancelled.current) return;
        setSuggestions(next);
        setOpen(next.length > 0);
        setActive(-1);
      } catch {
        // Places being down must never block typing an address by hand.
        if (!cancelled.current) setOpen(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled.current = true;
      clearTimeout(timer);
    };
  }, [value]);

  // Close when focus or a click leaves the field entirely.
  useEffect(() => {
    const onDocPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, []);

  const select = (s: Suggestion) => {
    justSelected.current = true;
    onChange(s.full);
    setOpen(false);
    setSuggestions([]);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      // Only intercept Enter when a suggestion is actually highlighted, so it still
      // submits the form when the customer typed the address themselves.
      if (active >= 0) {
        e.preventDefault();
        select(suggestions[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      {icon && <MapPin className="pointer-events-none absolute left-4 top-[1.4rem] h-4 w-4 -translate-y-1/2 text-muted-foreground" />}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className={inputClassName}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // pointerdown, not click: the input's blur would otherwise close the list
              // before a click could land on it.
              onPointerDown={(e) => {
                e.preventDefault();
                select(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-4 py-2.5 text-sm ${i === active ? "bg-primary/10" : "hover:bg-muted"}`}
            >
              <span className="block font-medium text-foreground">{s.main}</span>
              {s.secondary && <span className="block text-xs text-muted-foreground">{s.secondary}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
