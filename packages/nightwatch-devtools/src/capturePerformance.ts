/**
 * Script to capture performance data, cookies, and document info from the browser
 * This gets injected and executed in the browser context
 */

/**
 * Returns the script as a string to be executed in the browser
 */
export const getCapturePerformanceScript = (): string => {
  return `
    (function() {
      const performance = window.performance;
      const navigation = performance.getEntriesByType?.('navigation')?.[0];
      const resources = performance.getEntriesByType?.('resource') || [];

      return {
        navigation: navigation ? {
          url: window.location.href,
          timing: {
            loadTime: navigation.loadEventEnd - navigation.fetchStart,
            domReady: navigation.domContentLoadedEventEnd - navigation.fetchStart,
            responseTime: navigation.responseEnd - navigation.requestStart,
            dnsLookup: navigation.domainLookupEnd - navigation.domainLookupStart,
            tcpConnection: navigation.connectEnd - navigation.connectStart,
            serverResponse: navigation.responseEnd - navigation.responseStart
          }
        } : undefined,
        resources: resources.map(function(resource) {
          return {
            url: resource.name,
            duration: resource.duration,
            size: resource.transferSize || 0,
            type: resource.initiatorType,
            startTime: resource.startTime,
            responseEnd: resource.responseEnd
          };
        }),
        cookies: document.cookie,
        documentInfo: {
          url: window.location.href,
          title: document.title,
          headers: {
            userAgent: navigator.userAgent,
            language: navigator.language,
            platform: navigator.platform
          },
          documentInfo: {
            readyState: document.readyState,
            referrer: document.referrer,
            characterSet: document.characterSet
          }
        }
      };
    })()
  `
}
