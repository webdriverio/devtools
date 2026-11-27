---
'@wdio/devtools-trace-query': minor
---

`openTrace(location, options, target)` opens a trace from a local zip, a run's output folder or an https URL such as a span's `devtools.artifact.url`. In a folder, the artifacts manifests map a test's uid, spec file, session and attempt to its zip, and an error lists the folder's tests, failed first, when none is named; a folder without a manifest opens its only zip. Local paths must resolve inside `allowedRoots`, URLs are fetched only from `allowedHosts` over https, on a connection of their own, never from a private address (an IP literal or a resolved name, including IPv4 carried in IPv6) unless `allowPrivateNetwork` is set, and `maxZipBytes` and `maxInflatedBytes` cap what is read.
