import { randomUUID } from 'node:crypto';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const publicNote = ({ id, title, content }) => ({ id, title, body: content });

// Public wire names are distinct from the unchanged SQL column names.
export function createFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['id', 'title', 'body'].includes(key))
      || typeof input.title !== 'string' || typeof input.body !== 'string'
      || input.title.trim().length < 1 || input.title.trim().length > 200
      || input.body.length > 10000
      || (input.id !== undefined && (typeof input.id !== 'string' || !UUID.test(input.id)))) return null;
  return { id: input.id?.toLowerCase() ?? randomUUID(), title: input.title.trim(), content: input.body };
}

export function putFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['title', 'body'].includes(key))
      || typeof input.title !== 'string' || typeof input.body !== 'string'
      || input.title.trim().length < 1 || input.title.trim().length > 200
      || input.body.length > 10000) return null;
  return { title: input.title.trim(), content: input.body };
}

// Path IDs are canonical. Query IDs remain an internal rewrite/legacy alias.
export function noteRoute(request) {
  try {
    const url = new URL(request.url ?? '/api/notes', 'https://notes.internal');
    if (url.origin !== 'https://notes.internal') return { invalid: true };
    const path = url.pathname;
    const item = /^\/api\/notes\/([^/]+)\/?$/u.exec(path);
    if (!item && !['/api/notes', '/api/notes/'].includes(path)) return { invalid: true };
    const ids = [];
    if (item) ids.push(decodeURIComponent(item[1]));
    const queryIds = url.searchParams.getAll('id');
    if (queryIds.length > 1) return { invalid: true };
    ids.push(...queryIds);
    if (request.query?.id !== undefined) {
      if (typeof request.query.id !== 'string') return { invalid: true };
      ids.push(request.query.id);
    }
    if (!ids.length) return { invalid: false, isItem: false };
    if (ids.some(id => !UUID.test(id)) || ids.some(id => id.toLowerCase() !== ids[0].toLowerCase())) return { invalid: true };
    return { invalid: false, isItem: true, id: ids[0].toLowerCase() };
  } catch { return { invalid: true }; }
}
