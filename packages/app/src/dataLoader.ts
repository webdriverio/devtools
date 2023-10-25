import data from '../../../trace.json'

for (const change of data) {
  window.dispatchEvent(new CustomEvent('app-mutation', { detail: change }))
}
