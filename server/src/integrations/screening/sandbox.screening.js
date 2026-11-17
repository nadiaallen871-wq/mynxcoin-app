/**
 * Sandbox sanctions / PEP screening provider.
 *
 * It contacts no external list. It returns POTENTIAL_MATCH only for the documented
 * test names below, so reviewers can exercise the match-handling workflow. Every
 * other name is CLEAR, which in sandbox means "not screened against real lists".
 * The admin UI shows the provider name, so this is never mistaken for real screening.
 *
 * Production providers (e.g. a commercial watch-list API) implement:
 *   screen({ fullName, dateOfBirth, nationality }) -> { status, matches[] }
 */
export const SANDBOX_TEST_NAMES = Object.freeze(['sandbox sanctioned', 'test pep match']);

export function createSandboxScreening() {
  return {
    name: 'sandbox',
    async screen({ fullName }) {
      const normalized = fullName.toLowerCase().replace(/\s+/g, ' ').trim();
      const hit = SANDBOX_TEST_NAMES.find((n) => normalized.includes(n));
      if (!hit) return { status: 'CLEAR', matches: [] };
      return {
        status: 'POTENTIAL_MATCH',
        matches: [{ list: hit.includes('pep') ? 'SANDBOX-PEP' : 'SANDBOX-SANCTIONS', matchedName: hit, score: 0.97 }],
      };
    },
  };
}
