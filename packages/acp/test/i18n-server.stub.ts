import { setupI18n } from '@lingui/core';

/**
 * Test stand-in for `@documenso/lib/client-only/providers/i18n-server`.
 *
 * The real module eagerly imports every compiled translation catalogue at
 * module load, which is not available in a fresh checkout. The agents pull it
 * in transitively (email rendering), so the unit tests alias it here.
 */
const instance = setupI18n({ locale: 'en', messages: { en: {} } });

export const allI18nInstances = Promise.resolve({ en: instance });

export const getI18nInstance = async () => instance;
