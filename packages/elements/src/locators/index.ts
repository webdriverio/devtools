/**
 * Mobile element locator generation — re-exported from @wdio/devtools-core.
 */

export type {
  ElementAttributes,
  JSONElement,
  Bounds,
  FilterOptions,
  UniquenessResult,
  LocatorStrategy,
  LocatorContext,
  ElementWithLocators,
  GenerateLocatorsOptions
} from '@wdio/devtools-core/locators'

export {
  ANDROID_INTERACTABLE_TAGS,
  IOS_INTERACTABLE_TAGS,
  ANDROID_LAYOUT_CONTAINERS,
  IOS_LAYOUT_CONTAINERS,
  xmlToJSON,
  xmlToDOM,
  evaluateXPath,
  checkXPathUniqueness,
  findDOMNodeByPath,
  parseAndroidBounds,
  parseIOSBounds,
  flattenElementTree,
  countAttributeOccurrences,
  isAttributeUnique,
  isInteractableElement,
  isLayoutContainer,
  hasMeaningfulContent,
  shouldIncludeElement,
  getDefaultFilters,
  getSuggestedLocators,
  getBestLocator,
  locatorsToObject,
  generateAllElementLocators
} from '@wdio/devtools-core/locators'
