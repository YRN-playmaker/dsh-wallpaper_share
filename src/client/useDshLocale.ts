// src/client/useDshLocale.ts
import { useState, useEffect } from 'react';
import { messages, SupportedLang, LocaleKey } from './i18n';

export function useDshLocale(ctx?: any) {
  const getInitialLang = (): SupportedLang => {
    // 1. 优先读取 Harness 上下文中的语言偏好
    const ctxLang = ctx?.locale?.current || ctx?.locale?.preference;
    if (ctxLang?.startsWith('en')) return 'en';
    if (ctxLang?.startsWith('zh')) return 'zh';

    // 2. 次级读取 html 标签属性或浏览器语言
    const docLang = document.documentElement.lang;
    if (docLang?.startsWith('en')) return 'en';
    if (navigator.language?.startsWith('en')) return 'en';

    return 'zh';
  };

  const [lang, setLang] = useState<SupportedLang>(getInitialLang);

  useEffect(() => {
    // 监听 DSH 官方 locale/change 事件
    if (ctx?.on) {
      const dispose = ctx.on('locale/change', (newLocale: string) => {
        setLang(newLocale?.startsWith('en') ? 'en' : 'zh');
      });
      return () => dispose?.();
    }

    // 降级方案：监听 html 标签的 lang 属性变化
    const observer = new MutationObserver(() => {
      const currentDocLang = document.documentElement.lang;
      setLang(currentDocLang.startsWith('en') ? 'en' : 'zh');
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['lang']
    });

    return () => observer.disconnect();
  }, [ctx]);

  const t = (key: LocaleKey): string => {
    return messages[lang]?.[key] || messages.zh[key] || key;
  };

  return { lang, t };
}