/** Event names and template keys, e.g. `order.paid`, `user:signup`, `welcome-email`. */
export const EVENT_NAME_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/

export const isValidEventName = (value: string): boolean => EVENT_NAME_PATTERN.test(value)
