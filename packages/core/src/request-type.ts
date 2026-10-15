/** The classifier lives in shared so the page collector can share its table;
 *  re-exported here because `getRequestType` is part of core's public API. */
export { getRequestType } from '@wdio/devtools-shared'
