import { useEffect, useState } from 'react';

export function useURLSearchParam(
  key: string,
  defaultValue: string | null = null,
) {
  // Initialize state from current URL (SSR-safe) or fallback to defaultValue
  const [paramValue, setParamValue] = useState<string | null>(() => {
    const params =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
    return params.get(key) ?? defaultValue;
  });

  useEffect(() => {
    function updateParam() {
      const params = new URLSearchParams(window.location.search);
      setParamValue(params.get(key) ?? defaultValue);
    }

    updateParam();
    window.addEventListener('popstate', updateParam);
    return () => {
      window.removeEventListener('popstate', updateParam);
    };
  }, [key, defaultValue]);

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
    window.history.pushState({}, '', newUrl);
    setParamValue(value ?? defaultValue);
  };

  return [paramValue, setURLParam] as const;
}
