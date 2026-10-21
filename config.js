/* Phonebook API configuration.
 * The Cloudflare URL below has been provided, but /health has not yet been
 * confirmed to reach the correct Apps Script v17 + Google Sheets backend.
 * Keep apiUrl empty for production fallback until the health check passes.
 */
window.PHONEBOOK_CONFIG = Object.freeze({
  apiUrl: '',
  pendingWorkerApiUrl: 'https://phonebook-api.muhammadeirchard-m.workers.dev/api'
});
