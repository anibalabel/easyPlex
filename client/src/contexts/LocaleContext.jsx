import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import translations from '../i18n/translations.json';
import api from '../lib/api';

const LocaleContext = createContext({
  locale: 'en',
  setLocale: () => {},
  t: (k) => k,
  supportedLocales: [],
});

export const LOCALE_OPTIONS = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'es', label: 'Español', short: 'ES' },
  { code: 'fr', label: 'Français', short: 'FR' },
  { code: 'pt', label: 'Português', short: 'PT' },
  { code: 'br', label: 'Português (BR)', short: 'BR' },
];

const LOCALE_KEY = 'easyplex_locale';
const ATTRIBUTES_TO_TRANSLATE = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE']);

function buildLookup(dict) {
  const exact = new Map();
  const lower = new Map();
  if (!dict) return { exact, lower };
  for (const [k, v] of Object.entries(dict)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const normK = k.replace(/\s+/g, ' ').trim();
    if (!normK || v.trim() === normK) continue;
    exact.set(normK, v);
    const lc = normK.toLowerCase();
    if (!lower.has(lc)) lower.set(lc, v);
  }
  return { exact, lower };
}

function lookupTranslation(core, lookup) {
  if (!core || !lookup) return null;
  if (lookup.exact.has(core)) return lookup.exact.get(core);

  // Preserve trailing " *" (required marker) or ":" when base label matches
  for (const suffix of [' *', '*:', ':']) {
    if (core.endsWith(suffix)) {
      const base = core.slice(0, -suffix.length).trim();
      const baseMatch = lookup.exact.get(base) || lookup.lower.get(base.toLowerCase());
      if (baseMatch) return `${baseMatch}${suffix}`;
    }
  }

  return lookup.lower.get(core.toLowerCase()) || null;
}

function translateSentence(raw, lookup) {
  if (!raw || typeof raw !== 'string') return raw;
  const leading = raw.match(/^\s*/)?.[0] || '';
  const trailing = raw.match(/\s*$/)?.[0] || '';
  const core = raw.replace(/\s+/g, ' ').trim();
  if (!core || /^[\d\s.,:/$€£%+\-*•—()[\]#@!?]+$/.test(core)) return raw;
  const translated = lookupTranslation(core, lookup);
  if (!translated) return raw;
  return `${leading}${translated}${trailing}`;
}

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCALE_KEY);
      return LOCALE_OPTIONS.some((l) => l.code === saved) ? saved : 'en';
    } catch {
      return 'en';
    }
  });

  const origTextRef = useRef(new WeakMap());
  const appliedTextRef = useRef(new WeakMap());
  const origAttrsRef = useRef(new WeakMap());
  const appliedAttrsRef = useRef(new WeakMap());
  const isApplyingRef = useRef(false);

  const lookup = useMemo(() => {
    if (locale === 'en') return null;
    return buildLookup(translations[locale] || {});
  }, [locale]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // ignore
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback(async (nextLocale) => {
    if (!LOCALE_OPTIONS.some((l) => l.code === nextLocale)) return;
    setLocaleState(nextLocale);
    try {
      await api.post('/admin/locale', { locale: nextLocale });
    } catch {
      // allow client-side locale switch even when logged out
    }
  }, []);

  const t = useCallback(
    (key, fallback) => {
      if (locale === 'en') return translations.en?.[key] || fallback || key;
      const dict = translations[locale] || {};
      if (dict[key]) return dict[key];
      const norm = String(key || '').replace(/\s+/g, ' ').trim();
      const hit = lookupTranslation(norm, lookup);
      if (hit) return hit;
      if (translations.en?.[key]) return translations.en[key];
      return fallback ?? key;
    },
    [locale, lookup]
  );

  // Automatic, reversible DOM translator aligned with EasyPlex 2.4 autoUiTranslation
  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return undefined;

    const shouldSkipElement = (el) => {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.closest('[data-no-i18n="true"]')) return true;
      return false;
    };

    const syncTextNode = (node) => {
      if (!node || node.nodeType !== Node.TEXT_NODE) return;
      const parent = node.parentElement;
      if (shouldSkipElement(parent)) return;

      const cur = node.nodeValue;
      const lastApplied = appliedTextRef.current.get(node);
      if (!origTextRef.current.has(node) || (lastApplied !== undefined && cur !== lastApplied)) {
        origTextRef.current.set(node, cur);
      } else if (lastApplied === undefined) {
        origTextRef.current.set(node, cur);
      }

      const original = origTextRef.current.get(node);
      const target = locale === 'en' ? original : translateSentence(original, lookup);
      if (node.nodeValue !== target) {
        node.nodeValue = target;
      }
      if (target !== original) {
        appliedTextRef.current.set(node, target);
      } else {
        appliedTextRef.current.delete(node);
      }
    };

    const syncElementAttrs = (el) => {
      if (shouldSkipElement(el)) return;
      let origMap = origAttrsRef.current.get(el);
      let appMap = appliedAttrsRef.current.get(el);

      for (const attr of ATTRIBUTES_TO_TRANSLATE) {
        if (!el.hasAttribute(attr)) continue;
        const cur = el.getAttribute(attr);
        if (!origMap) {
          origMap = new Map();
          origAttrsRef.current.set(el, origMap);
        }
        if (!appMap) {
          appMap = new Map();
          appliedAttrsRef.current.set(el, appMap);
        }
        const prevApplied = appMap.get(attr);
        if (!origMap.has(attr) || (prevApplied !== undefined && cur !== prevApplied)) {
          origMap.set(attr, cur);
        } else if (prevApplied === undefined) {
          origMap.set(attr, cur);
        }

        const original = origMap.get(attr);
        const target = locale === 'en' ? original : translateSentence(original, lookup);
        if (el.getAttribute(attr) !== target) {
          el.setAttribute(attr, target);
        }
        if (target !== original) {
          appMap.set(attr, target);
        } else {
          appMap.delete(attr);
        }
      }
    };

    const translateSubtree = (root) => {
      if (!root) return;
      if (root.nodeType === Node.TEXT_NODE) {
        syncTextNode(root);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      if (shouldSkipElement(root)) return;

      syncElementAttrs(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        if (current.nodeType === Node.TEXT_NODE) syncTextNode(current);
        else if (current.nodeType === Node.ELEMENT_NODE) syncElementAttrs(current);
        current = walker.nextNode();
      }
    };

    const runPass = (roots = [document.body]) => {
      if (isApplyingRef.current) return;
      isApplyingRef.current = true;
      try {
        for (const r of roots) translateSubtree(r);
      } finally {
        isApplyingRef.current = false;
      }
    };

    runPass([document.body]);

    let pendingNodes = new Set();
    let rafId = null;

    const flush = () => {
      rafId = null;
      const nodes = Array.from(pendingNodes);
      pendingNodes.clear();
      if (nodes.length > 0) runPass(nodes);
    };

    const observer = new MutationObserver((mutations) => {
      if (isApplyingRef.current) return;
      for (const m of mutations) {
        if (m.type === 'characterData') {
          pendingNodes.add(m.target);
        } else if (m.type === 'attributes') {
          pendingNodes.add(m.target);
        } else if (m.addedNodes?.length) {
          m.addedNodes.forEach((n) => pendingNodes.add(n));
        }
      }
      if (!rafId && pendingNodes.size > 0) {
        rafId = window.requestAnimationFrame(flush);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES_TO_TRANSLATE,
    });

    return () => {
      observer.disconnect();
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [locale, lookup]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t, supportedLocales: LOCALE_OPTIONS }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
