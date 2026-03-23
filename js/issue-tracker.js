const ISSUE_STORAGE_KEY = 'catchMeRuntimeIssues';
const MAX_ISSUES = 60;

/**
 * Persist and broadcast runtime issues for easier debugging.
 * @param {'audio'|'assets'|'runtime'|'ui'} kind
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
export function reportIssue(kind, message, meta = {}) {
    const entry = {
        kind,
        message,
        meta,
        at: new Date().toISOString(),
    };
    try {
        const raw = localStorage.getItem(ISSUE_STORAGE_KEY);
        const parsed = JSON.parse(raw || '[]');
        const list = Array.isArray(parsed) ? parsed : [];
        list.push(entry);
        if (list.length > MAX_ISSUES) {
            list.splice(0, list.length - MAX_ISSUES);
        }
        localStorage.setItem(ISSUE_STORAGE_KEY, JSON.stringify(list));
    } catch {
        // Storage can fail in private modes; keep logging fallback.
    }
    try {
        window.dispatchEvent(new CustomEvent('game:issue', { detail: entry }));
    } catch {
        // Ignore event-dispatch failures in very old browsers.
    }
    console.warn(`[GameIssue:${kind}] ${message}`, meta);
}
