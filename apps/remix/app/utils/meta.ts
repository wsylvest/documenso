import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { i18n, type MessageDescriptor } from '@lingui/core';

export const APP_NAME = 'SmartRoofing AI';

export const appMetaTags = (title?: MessageDescriptor) => {
  const description =
    'Sign roofing contracts, proposals and change orders online with SmartRoofing AI. Secure electronic signatures with a signing certificate and audit trail, powered by the open-source Documenso platform.';

  return [
    {
      title: title ? `${i18n._(title)} - ${APP_NAME}` : APP_NAME,
    },
    {
      name: 'description',
      content: description,
    },
    {
      name: 'keywords',
      content:
        'SmartRoofing AI, roofing contracts, document signing, electronic signature, e-signature, roofing proposals, signing certificate',
    },
    {
      name: 'author',
      content: APP_NAME,
    },
    {
      name: 'robots',
      content: 'index, follow',
    },
    {
      name: 'theme-color',
      content: '#e30516',
    },
    {
      property: 'og:title',
      content: `${APP_NAME} - Document signing for roofers`,
    },
    {
      property: 'og:description',
      content: description,
    },
    {
      property: 'og:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/opengraph-image.jpg`,
    },
    {
      property: 'og:type',
      content: 'website',
    },
    {
      name: 'twitter:card',
      content: 'summary_large_image',
    },
    {
      name: 'twitter:description',
      content: description,
    },
    {
      name: 'twitter:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/opengraph-image.jpg`,
    },
  ];
};
