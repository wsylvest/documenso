import { useCopyToClipboard } from '@documenso/lib/client-only/hooks/use-copy-to-clipboard';
import { AppError } from '@documenso/lib/errors/app-error';
import { trpc } from '@documenso/trpc/react';
import { ZCreateUserRequestSchema } from '@documenso/trpc/server/admin-router/create-user.types';
import { ZPasswordSchema } from '@documenso/trpc/server/auth-router/schema';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@documenso/ui/primitives/form/form';
import { Input } from '@documenso/ui/primitives/input';
import { PasswordInput } from '@documenso/ui/primitives/password-input';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, useLingui } from '@lingui/react/macro';
import type * as DialogPrimitive from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

export type AdminUserCreateDialogProps = {
  trigger?: React.ReactNode;
} & Omit<DialogPrimitive.DialogProps, 'children'>;

// An empty password means "send a welcome email" rather than a validation error.
const ZFormSchema = ZCreateUserRequestSchema.extend({
  password: z.union([z.literal(''), ZPasswordSchema]).optional(),
});

type TFormSchema = z.infer<typeof ZFormSchema>;

export const AdminUserCreateDialog = ({ trigger, ...props }: AdminUserCreateDialogProps) => {
  const { t } = useLingui();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [, copy] = useCopyToClipboard();

  const navigate = useNavigate();

  const form = useForm<TFormSchema>({
    resolver: zodResolver(ZFormSchema),
    defaultValues: {
      email: '',
      name: '',
      password: '',
    },
  });

  const { mutateAsync: createUser } = trpc.admin.user.create.useMutation();

  const generatePassword = () => {
    // 20 characters from a set that satisfies the password rules and avoids look-alikes.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const password = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');

    form.setValue('password', password, { shouldDirty: true, shouldValidate: true });
  };

  const onFormSubmit = async (data: TFormSchema) => {
    const password = data.password?.trim() || undefined;

    try {
      const result = await createUser({ ...data, password });

      if (password) {
        await copy(`${data.email}\n${password}`);
      }

      await navigate(`/admin/users/${result.userId}`);

      setOpen(false);

      toast({
        title: t`Success`,
        description: password
          ? t`User created. The email and password have been copied to your clipboard.`
          : t`User created and welcome email sent`,
        duration: 5000,
      });
    } catch (err) {
      const error = AppError.parseError(err);

      console.error(error);

      toast({
        title: t`An error occurred`,
        description: error.message || t`We encountered an error while creating the user. Please try again later.`,
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    form.reset();
  }, [open, form]);

  return (
    <Dialog {...props} open={open} onOpenChange={(value) => !form.formState.isSubmitting && setOpen(value)}>
      <DialogTrigger onClick={(e) => e.stopPropagation()} asChild={true}>
        {trigger ?? (
          <Button className="flex-shrink-0" variant="secondary">
            <Trans>Create User</Trans>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent position="center">
        <DialogHeader>
          <DialogTitle>
            <Trans>Create User</Trans>
          </DialogTitle>

          <DialogDescription>
            <Trans>
              Create a new user. Leave the password blank to send a welcome email with a link to set one, or set a
              password here to hand over directly.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onFormSubmit)}>
            <fieldset className="flex h-full flex-col space-y-4" disabled={form.formState.isSubmitting}>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>
                      <Trans>Email</Trans>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} type="email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>
                      <Trans>Name</Trans>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <Trans>Password</Trans>
                    </FormLabel>
                    <FormControl>
                      <div className="flex gap-2">
                        <PasswordInput {...field} value={field.value ?? ''} autoComplete="new-password" />
                        <Button type="button" variant="secondary" onClick={generatePassword}>
                          <Trans>Generate</Trans>
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  <Trans>Cancel</Trans>
                </Button>

                <Button type="submit" data-testid="dialog-create-user-button" loading={form.formState.isSubmitting}>
                  <Trans>Create</Trans>
                </Button>
              </DialogFooter>
            </fieldset>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
