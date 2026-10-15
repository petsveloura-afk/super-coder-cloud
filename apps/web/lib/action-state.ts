/** Uniform result shape for server actions consumed via useActionState. */
export interface ActionState<T = undefined> {
  ok?: boolean;
  /** i18n key of a form-level error */
  error?: string;
  /** field → i18n key */
  fieldErrors?: Record<string, string>;
  /** i18n key of a success message */
  message?: string;
  messageParams?: Record<string, string | number>;
  data?: T;
  /** Echo of submitted values so forms keep input after a failed submit */
  values?: Record<string, string>;
}

export const initialState: ActionState = {};

export function formValues(fd: FormData, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = fd.get(k);
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Map Postgres/PostgREST error codes to i18n keys without leaking internals. */
export function dbErrorKey(error: { code?: string; message?: string } | null | undefined): string {
  switch (error?.code) {
    case "42501":
      return "errors.forbidden";
    case "23505":
      return "common.error";
    case "PGRST116":
      return "errors.notFound";
    default:
      return "errors.generic";
  }
}
