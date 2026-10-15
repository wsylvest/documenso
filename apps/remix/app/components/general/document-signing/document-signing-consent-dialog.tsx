import { useAnalytics } from '@documenso/lib/client-only/hooks/use-analytics';
import { PAPER_COPY_REQUESTED_REJECTION_REASON } from '@documenso/lib/constants/electronic-consent';
import { mapSecondaryIdToDocumentId } from '@documenso/lib/utils/envelope';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Checkbox } from '@documenso/ui/primitives/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@documenso/ui/primitives/dialog';
import { Label } from '@documenso/ui/primitives/label';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { Link } from 'react-router';

import { useEmbedSigningContext } from '~/components/embed/embed-signing-context';

import { useRequiredEnvelopeSigningContext } from './envelope-signing-provider';

/**
 * ESIGN consumer consent gate.
 *
 * Shown before a recipient can interact with any field. The server refuses
 * field signing and completion until consent is recorded, so this dialog
 * cannot be dismissed without either consenting or declining in favour of a
 * paper copy, which rejects the document with a recognisable reason.
 */
export const DocumentSigningConsentDialog = () => {
  const { t } = useLingui();
  const { toast } = useToast();
  const analytics = useAnalytics();

  const { envelope, recipient, requiresElectronicConsent, markElectronicConsent } = useRequiredEnvelopeSigningContext();

  const { isEmbed = false, onDocumentRejected } = useEmbedSigningContext() || {};

  const [hasAgreed, setHasAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { mutateAsync: consentToElectronicSigning } = trpc.envelope.consentToElectronicSigning.useMutation();
  const { mutateAsync: rejectDocumentWithToken } = trpc.recipient.rejectDocumentWithToken.useMutation();

  // Only valid for documents; direct templates never open this dialog, so
  // resolve lazily to avoid throwing on `template_*` IDs during render.
  const getDocumentId = () => mapSecondaryIdToDocumentId(envelope.secondaryId);

  const onContinue = async () => {
    setIsSubmitting(true);

    try {
      const { electronicConsentAt } = await consentToElectronicSigning({ token: recipient.token });

      markElectronicConsent(electronicConsentAt);
    } catch (err) {
      analytics.captureException(err, {
        source: 'signing',
        location: 'electronic_consent',
        documentId: getDocumentId(),
      });

      toast({
        title: t`Error`,
        description: t`We could not record your consent. Please try again.`,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onRequestPaperCopy = async () => {
    setIsSubmitting(true);

    try {
      const documentId = getDocumentId();

      await rejectDocumentWithToken({
        documentId,
        token: recipient.token,
        reason: PAPER_COPY_REQUESTED_REJECTION_REASON,
      });

      if (isEmbed && onDocumentRejected) {
        onDocumentRejected({
          token: recipient.token,
          documentId,
          envelopeId: envelope.id,
          recipientId: recipient.id,
          reason: PAPER_COPY_REQUESTED_REJECTION_REASON,
        });

        return;
      }

      window.location.href = `/sign/${recipient.token}/rejected?paper=1`;
    } catch (err) {
      analytics.captureException(err, {
        source: 'signing',
        location: 'electronic_consent_paper_copy',
        documentId: getDocumentId(),
      });

      toast({
        title: t`Error`,
        description: t`We could not send your request for a paper copy. Please try again.`,
        variant: 'destructive',
      });

      setIsSubmitting(false);
    }
  };

  if (!requiresElectronicConsent) {
    return null;
  }

  return (
    <Dialog open={true}>
      <DialogContent
        className="sm:max-w-xl"
        hideClose={true}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        data-testid="electronic-consent-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            <Trans>Consent to do business electronically</Trans>
          </DialogTitle>

          <DialogDescription>
            <Trans>
              Before you review and sign "{envelope.title}", please confirm that you agree to receive this document and
              related notices electronically and to sign it with an electronic signature.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-muted-foreground text-sm">
          <p>
            <Trans>
              Your electronic signature will carry the same legal effect as a handwritten signature under the U.S.
              Electronic Signatures in Global and National Commerce Act (ESIGN) and applicable state law.
            </Trans>
          </p>

          <div>
            <p className="font-medium text-foreground">
              <Trans>What you need</Trans>
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                <Trans>A device with an up-to-date web browser and an internet connection</Trans>
              </li>
              <li>
                <Trans>Access to the email address this document was sent to</Trans>
              </li>
              <li>
                <Trans>A PDF reader, and a printer or storage to keep a copy for your records</Trans>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-medium text-foreground">
              <Trans>Your copy and your rights</Trans>
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                <Trans>
                  When everyone has signed, the completed document will be emailed to you and remains available to
                  download from your signing link at no charge.
                </Trans>
              </li>
              <li>
                <Trans>
                  You may withdraw this consent at any time before you finish signing by closing this page and
                  contacting the sender.
                </Trans>
              </li>
              <li>
                <Trans>
                  You may choose to sign on paper instead. Selecting "I prefer a paper copy" notifies the sender so they
                  can provide one.
                </Trans>
              </li>
            </ul>
          </div>

          <p>
            <Trans>
              Read the full{' '}
              <Link className="text-documenso-700 underline" to="/articles/signature-disclosure" target="_blank">
                electronic signature disclosure
              </Link>
              .
            </Trans>
          </p>

          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3">
            <Checkbox
              id="electronic-consent-checkbox"
              data-testid="electronic-consent-checkbox"
              checked={hasAgreed}
              onCheckedChange={(value) => setHasAgreed(value === true)}
              disabled={isSubmitting}
              className="mt-0.5"
            />
            <Label
              htmlFor="electronic-consent-checkbox"
              className="cursor-pointer font-normal text-foreground leading-snug"
            >
              <Trans>
                I have read the disclosure above and I agree to receive this document electronically and to sign it
                using an electronic signature.
              </Trans>
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            data-testid="electronic-consent-paper-copy"
            disabled={isSubmitting}
            onClick={onRequestPaperCopy}
          >
            <Trans>I prefer a paper copy</Trans>
          </Button>

          <Button
            type="button"
            data-testid="electronic-consent-continue"
            disabled={!hasAgreed}
            loading={isSubmitting}
            onClick={onContinue}
          >
            <Trans>Agree and continue</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
