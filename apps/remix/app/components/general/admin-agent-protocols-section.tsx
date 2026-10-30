import {
  SITE_SETTINGS_AGENT_PROTOCOLS_ID,
  type TSiteSettingsAgentProtocolsSchema,
} from '@documenso/lib/server-only/site-settings/schemas/agent-protocols';
import { trpc as trpcReact } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from '@documenso/ui/primitives/form/form';
import { Switch } from '@documenso/ui/primitives/switch';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { useForm } from 'react-hook-form';
import { useRevalidator } from 'react-router';
import { z } from 'zod';

const ZAgentProtocolsFormSchema = z.object({
  mcpEnabled: z.boolean(),
  acpEnabled: z.boolean(),
});

type TAgentProtocolsFormSchema = z.infer<typeof ZAgentProtocolsFormSchema>;

type AdminAgentProtocolsSectionProps = {
  agentProtocols: TSiteSettingsAgentProtocolsSchema | undefined;
};

export const AdminAgentProtocolsSection = ({ agentProtocols }: AdminAgentProtocolsSectionProps) => {
  const { toast } = useToast();
  const { _ } = useLingui();
  const { revalidate } = useRevalidator();

  const form = useForm<TAgentProtocolsFormSchema>({
    resolver: zodResolver(ZAgentProtocolsFormSchema),
    defaultValues: {
      // Both protocols are on until an admin switches them off.
      mcpEnabled: agentProtocols?.data?.mcpEnabled ?? true,
      acpEnabled: agentProtocols?.data?.acpEnabled ?? true,
    },
  });

  const { mutateAsync: updateSiteSetting, isPending: isUpdateSiteSettingLoading } =
    trpcReact.admin.updateSiteSetting.useMutation();

  const onAgentProtocolsUpdate = async ({ mcpEnabled, acpEnabled }: TAgentProtocolsFormSchema) => {
    try {
      await updateSiteSetting({
        id: SITE_SETTINGS_AGENT_PROTOCOLS_ID,
        enabled: true,
        data: {
          mcpEnabled,
          acpEnabled,
        },
      });

      form.reset({ mcpEnabled, acpEnabled });

      toast({
        title: _(msg`Agent Protocols Updated`),
        description: _(msg`The agent protocol settings have been updated successfully.`),
        duration: 5000,
      });

      await revalidate();
    } catch {
      toast({
        title: _(msg`An unknown error occurred`),
        variant: 'destructive',
        description: _(
          msg`We encountered an unknown error while attempting to update the agent protocol settings. Please try again later.`,
        ),
      });
    }
  };

  return (
    <div>
      <h2 className="font-semibold">
        <Trans>Agent Protocols</Trans>
      </h2>
      <p className="mt-2 text-muted-foreground text-sm">
        <Trans>
          Switch the AI agent servers of this instance on or off without a restart. Each server also needs its
          deployment flag (NEXT_PUBLIC_MCP_ENABLED or NEXT_PUBLIC_ACP_ENABLED) and an organisation must be granted the
          matching access flag in its claims before its API tokens can use it. Changes take effect within 30 seconds.
        </Trans>
      </p>

      <Form {...form}>
        <form className="mt-4 flex flex-col rounded-md" onSubmit={form.handleSubmit(onAgentProtocolsUpdate)}>
          <fieldset className="space-y-6" disabled={isUpdateSiteSettingLoading}>
            <FormField
              control={form.control}
              name="mcpEnabled"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans>MCP server</Trans>
                  </FormLabel>

                  <FormControl>
                    <div>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </div>
                  </FormControl>

                  <FormDescription>
                    <Trans>
                      Model Context Protocol server at /api/mcp, used by assistants such as Claude or Cursor. When off,
                      requests receive a 503 MCP_DISABLED response.
                    </Trans>
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="acpEnabled"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans>ACP agent server</Trans>
                  </FormLabel>

                  <FormControl>
                    <div>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </div>
                  </FormControl>

                  <FormDescription>
                    <Trans>
                      Agent Communication Protocol server at /api/acp and the A2A agent card, used by agent
                      orchestrators. When off, every ACP route, including discovery, receives a 503 ACP_DISABLED
                      response.
                    </Trans>
                  </FormDescription>
                </FormItem>
              )}
            />
          </fieldset>

          <Button type="submit" loading={isUpdateSiteSettingLoading} className="mt-4 justify-end self-end">
            <Trans>Update Agent Protocols</Trans>
          </Button>
        </form>
      </Form>
    </div>
  );
};
