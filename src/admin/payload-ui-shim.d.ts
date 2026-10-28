// `@payloadcms/ui` is an optional peer and not installed for development, so the hooks the
// admin field uses are declared here. Keep them in line with Payload's real signatures.
declare module '@payloadcms/ui' {
  export function useForm(): { getData: () => Record<string, unknown> }
}
