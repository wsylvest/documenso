import { env } from '@documenso/lib/utils/env';
import type { SentMessageInfo, Transport } from 'nodemailer';
import type MailMessage from 'nodemailer/lib/mailer/mail-message';

import { normalizeMailHeaders } from './normalize-headers';

const VERSION = '1.0.0';

/** Any address input nodemailer accepts: a string, an address or group object, or nested arrays of these. */
type NodeMailerAddress = MailMessage['data']['to'] | MailMessage['data']['from'];

/** The callback nodemailer hands to a transport; the result is omitted on failure. */
type SendCallback = Parameters<Transport<SentMessageInfo>['send']>[1];

interface MailChannelsAddress {
  email: string;
  name?: string;
}

interface MailChannelsTransportOptions {
  apiKey: string;
  endpoint: string;
}

/**
 * Transport for sending email through MailChannels via Cloudflare Workers.
 *
 * Optionally allows specifying a custom endpoint and API key so you can setup a worker
 * to proxy requests to MailChannels with added security.
 *
 * @see https://blog.cloudflare.com/sending-email-from-workers-with-mailchannels/
 */
export class MailChannelsTransport implements Transport<SentMessageInfo> {
  public name = 'CloudflareMailTransport';
  public version = VERSION;

  private _options: MailChannelsTransportOptions;

  public static makeTransport(options: Partial<MailChannelsTransportOptions>) {
    return new MailChannelsTransport(options);
  }

  constructor(options: Partial<MailChannelsTransportOptions>) {
    const { apiKey = '', endpoint = 'https://api.mailchannels.net/tx/v1/send' } = options;

    this._options = {
      apiKey,
      endpoint,
    };
  }

  public send(mail: MailMessage, callback: SendCallback) {
    if (!mail.data.to || !mail.data.from) {
      return callback(new Error('Missing required fields "to" or "from"'));
    }

    const mailTo = this.toMailChannelsAddresses(mail.data.to);
    const mailCc = this.toMailChannelsAddresses(mail.data.cc);
    const mailBcc = this.toMailChannelsAddresses(mail.data.bcc);

    const [from] = this.toMailChannelsAddresses(mail.data.from);
    const [replyTo] = this.toMailChannelsAddresses(mail.data.replyTo);

    if (!from) {
      return callback(new Error('Missing required field "from"'));
    }

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this._options.apiKey) {
      requestHeaders['X-Auth-Token'] = this._options.apiKey;
    }

    fetch(this._options.endpoint, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        from: from,
        reply_to: replyTo,
        headers: normalizeMailHeaders(mail.data.headers),
        subject: mail.data.subject,
        personalizations: [
          {
            to: mailTo,
            cc: mailCc.length > 0 ? mailCc : undefined,
            bcc: mailBcc.length > 0 ? mailBcc : undefined,
            dkim_domain: env('NEXT_PRIVATE_MAILCHANNELS_DKIM_DOMAIN') || undefined,
            dkim_selector: env('NEXT_PRIVATE_MAILCHANNELS_DKIM_SELECTOR') || undefined,
            dkim_private_key: env('NEXT_PRIVATE_MAILCHANNELS_DKIM_PRIVATE_KEY') || undefined,
          },
        ],
        content: [
          {
            type: 'text/plain',
            value: mail.data.text?.toString('utf-8') ?? '',
          },
          {
            type: 'text/html',
            value: mail.data.html?.toString('utf-8') ?? '',
          },
        ],
      }),
    })
      .then((res) => {
        if (res.status >= 200 && res.status <= 299) {
          const recipients = [...mailTo, ...mailCc, ...mailBcc].map((recipient) => recipient.email);

          return callback(null, {
            messageId: '',
            envelope: {
              from: from.email,
              to: recipients,
            },
            accepted: recipients,
            rejected: [],
            pending: [],
          });
        }

        res
          .json()
          .then((data) => callback(new Error(`MailChannels error: ${data.message}`)))
          .catch((err) => callback(err));
      })
      .catch((err) => {
        return callback(err);
      });
  }

  /**
   * Converts a nodemailer address(s) to an array of MailChannel compatible address.
   */
  private toMailChannelsAddresses(address: NodeMailerAddress): Array<MailChannelsAddress> {
    if (!address) {
      return [];
    }

    if (typeof address === 'string') {
      return [{ email: address }];
    }

    // Arrays can be nested, so flatten recursively.
    if (Array.isArray(address)) {
      return address.flatMap((entry) => this.toMailChannelsAddresses(entry));
    }

    // Group addresses ("Team: a@x, b@x;") carry their members instead of an address of their own.
    if (address.group) {
      return address.group.flatMap((member) => this.toMailChannelsAddresses(member));
    }

    if (!address.address) {
      return [];
    }

    return [
      {
        email: address.address,
        name: address.name,
      },
    ];
  }
}
