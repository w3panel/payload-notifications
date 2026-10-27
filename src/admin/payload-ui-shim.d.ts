declare module '@payloadcms/ui' {
  export function useFormFields<T = Record<string, unknown>>(
    selector: (fields: unknown, dispatch: { getData: () => Record<string, unknown> }) => T,
  ): T
}
