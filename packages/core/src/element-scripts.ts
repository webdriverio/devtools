// The source lives in `shared` so the backend can serve it; this shim stays
// because an exports map may not point outside its own package.
export * from '@wdio/devtools-shared/element-scripts'
