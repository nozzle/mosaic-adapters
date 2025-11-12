import { useEffect, useState } from 'react';

type URLSearchParamOptions = {
  reloadOnChange?: boolean;
};

export function useURLSearchParam(
  key: string,
  defaultValue: string | null = null,
  { reloadOnChange }: URLSearchParamOptions = { reloadOnChange: false },
) {
  // Initialise from URL or default
  const [paramValue, setParamValue] = useState<string | null>(() => {
    if (typeof window === 'undefined') return defaultValue;
    const params = new URLSearchParams(window.location.search);
    return params.get(key) ?? defaultValue;
  });

  // Keep state in sync with browser navigation (back/forward) AND direct URL changes
  useEffect(() => {
    function updateParam() {
      const params = new URLSearchParams(window.location.search);
      const newValue = params.get(key) ?? defaultValue;
      setParamValue(newValue);
    }

    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', updateParam);

    // Poll for URL changes (catches manual URL edits, external updates, etc.)
    const intervalId = setInterval(() => {
      const params = new URLSearchParams(window.location.search);
      const currentValue = params.get(key) ?? defaultValue;
      if (currentValue !== paramValue) {
        setParamValue(currentValue);
      }
    }, 100);

    return () => {
      window.removeEventListener('popstate', updateParam);
      clearInterval(intervalId);
    };
  }, [key, defaultValue, paramValue]);

  const setURLParam = (value: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (value === null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }

    const newUrl =
      window.location.pathname +
      (params.toString() ? `?${params.toString()}` : '');

    if (reloadOnChange) {
      // Full reload to apply new query parameters
      window.location.href = newUrl;
    } else {
      // Just update URL and React state
      window.history.pushState({}, '', newUrl);
      setParamValue(value ?? defaultValue);
    }
  };

  return [paramValue, setURLParam] as const;
}
