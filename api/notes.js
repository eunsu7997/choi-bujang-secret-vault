// Emergency fail-closed maintenance gate. No database access or authentication fallback.
// Restore service only after the separately approved authentication/ownership release.
export default function handler(_request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Retry-After', '3600');
  return response.status(503).json({ error: 'NOTES_TEMPORARILY_UNAVAILABLE' });
}
