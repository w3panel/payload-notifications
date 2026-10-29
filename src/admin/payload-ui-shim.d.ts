// `@payloadcms/ui` is an optional peer and not installed for development, so the hooks the
// admin fields use are declared here. Keep them in line with Payload's real signatures.
declare module '@payloadcms/ui' {
  export function useForm(): { getData: () => Record<string, unknown> }
  export function useField<T = unknown>(options?: {
    path?: string
  }): {
    value: T
    setValue: (value: unknown, disableModifyingForm?: boolean) => void
  }
  export function useDocumentInfo(): { id?: number | string; collectionSlug?: string }
}
