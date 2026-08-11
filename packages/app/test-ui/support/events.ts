/** Collect the events of one type a component emits while `act` runs. Removes
 *  the listener even when `act` throws, so one failing spec can't leak into the
 *  next one's counts. */
export function capture<T>(
  target: EventTarget,
  type: string,
  act: () => void
): CustomEvent<T>[] {
  const received: CustomEvent<T>[] = []
  const listener = (event: Event) => received.push(event as CustomEvent<T>)
  target.addEventListener(type, listener)
  try {
    act()
  } finally {
    target.removeEventListener(type, listener)
  }
  return received
}
