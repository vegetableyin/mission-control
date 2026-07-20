import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { locales, defaultLocale, type Locale } from './config'

export default getRequestConfig(async () => {
  let locale: Locale = defaultLocale

  // 1. Check NEXT_LOCALE cookie
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value as Locale | undefined
  if (cookieLocale && locales.includes(cookieLocale)) {
    locale = cookieLocale
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
