import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { en } from '@/locales/en';
import { tr, TranslationSchema } from '@/locales/tr';
import { AppLanguage } from '@/types/profile';

const STORAGE_KEY = '@workout-tracker/language';
/** Mevcut kullanıcılar Türkçe ile devam eder. */
const DEFAULT_LANGUAGE: AppLanguage = 'tr';

const DICTIONARIES: Record<AppLanguage, TranslationSchema> = { en, tr };
const LOCALES: Record<AppLanguage, string> = { en: 'en-US', tr: 'tr-TR' };

type TranslateParams = Record<string, string | number>;

type LanguageContextValue = {
  language: AppLanguage;
  locale: string;
  setLanguage: (language: AppLanguage) => void;
  /** Sözlükten metin döndürür; {ad} yer tutucularını değiştirir. */
  t: (path: string, params?: TranslateParams) => string;
  /** Sözlükteki dizi değerlerini döndürür (hızlı sorular gibi). */
  tList: (path: string) => string[];
  translations: TranslationSchema;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function resolvePath(dictionary: TranslationSchema, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), dictionary);
}

function applyParams(value: string, params?: TranslateParams) {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, key: string) =>
    params[key] === undefined ? match : String(params[key]),
  );
}

export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<AppLanguage>(DEFAULT_LANGUAGE);

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((storedValue) => {
        if (!isMounted) return;
        if (storedValue === 'tr' || storedValue === 'en') setLanguageState(storedValue);
      })
      .catch(() => {
        // Yerel tercih okunamazsa varsayılan dil kullanılır.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
    void AsyncStorage.setItem(STORAGE_KEY, nextLanguage).catch(() => undefined);
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    const dictionary = DICTIONARIES[language];

    return {
      language,
      locale: LOCALES[language],
      setLanguage,
      t: (path: string, params?: TranslateParams) => {
        const value = resolvePath(dictionary, path);
        if (typeof value === 'string') return applyParams(value, params);

        // Anahtar bulunamazsa Türkçe sözlüğe düşülür, o da yoksa anahtar döner.
        const fallback = resolvePath(tr, path);
        return typeof fallback === 'string' ? applyParams(fallback, params) : path;
      },
      tList: (path: string) => {
        const value = resolvePath(dictionary, path);
        if (Array.isArray(value)) return value as string[];
        const fallback = resolvePath(tr, path);
        return Array.isArray(fallback) ? (fallback as string[]) : [];
      },
      translations: dictionary,
    };
  }, [language, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error('useLanguage, LanguageProvider içinde kullanılmalıdır.');
  }

  return context;
}

/** Ekranlarda kısa kullanım için. */
export function useTranslation() {
  const { language, locale, t, tList } = useLanguage();
  return { language, locale, t, tList };
}
