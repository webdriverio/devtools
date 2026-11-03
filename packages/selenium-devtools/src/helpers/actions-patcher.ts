import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import { PATCHED_SYMBOL } from '../constants.js'
import type {
  DriverPatcherHooks,
  Patchable,
  SeleniumDriverLike
} from '../types.js'

const log = logger('@wdio/selenium-devtools:actionsPatcher')

/** The driver each action sequence was built on, read when its perform() settles. */
const actionsOwners = new WeakMap<object, SeleniumDriverLike>()

function patchActionsPerform(
  actionsProto: Patchable,
  hooks: DriverPatcherHooks
): void {
  if (actionsProto[PATCHED_SYMBOL]) {
    return
  }
  actionsProto[PATCHED_SYMBOL] = true

  const originalPerform = actionsProto.perform as (
    this: unknown
  ) => Promise<void>
  actionsProto.perform = async function patchedPerform(this: unknown) {
    try {
      await originalPerform.call(this)
    } finally {
      const driver = actionsOwners.get(this as object)
      if (driver && hooks.afterActions) {
        try {
          hooks.afterActions(driver)
        } catch (err) {
          log.warn(`afterActions hook threw: ${errorMessage(err)}`)
        }
      }
    }
  }
}

/** perform() reaches the driver through execute(), so no wrapped method sees the page change it makes. */
export function patchActions(
  WebDriver: { prototype: object },
  hooks: DriverPatcherHooks
): void {
  const driverProto = WebDriver.prototype as Patchable
  const originalActions = driverProto.actions
  if (
    typeof originalActions !== 'function' ||
    PATCHED_SYMBOL in originalActions
  ) {
    return
  }
  const original = originalActions as (
    this: unknown,
    options?: unknown
  ) => object
  const patchedActions = function patchedActions(
    this: SeleniumDriverLike,
    options?: unknown
  ) {
    const actions = original.call(this, options)
    actionsOwners.set(actions, this)
    patchActionsPerform(Object.getPrototypeOf(actions) as Patchable, hooks)
    return actions
  }
  driverProto.actions = Object.assign(patchedActions, {
    [PATCHED_SYMBOL]: true
  })
}
