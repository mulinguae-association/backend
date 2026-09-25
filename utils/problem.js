/**
 * RFC 9457 problem details, used as the single error envelope for the API.
 *
 * Every failure responds with application/problem+json:
 *   type    URI identifying the problem kind. A URN by default, so it cannot
 *           rot into a dead link; override with PROBLEM_TYPE_BASE.
 *   title   short, human-readable summary of the problem type.
 *   status  the HTTP status, duplicated in the body so a logged payload is
 *           self-describing.
 *   code    stable machine-readable extension. This is the only field clients
 *           branch on, and the only one they may rely on: `title` and `detail`
 *           are English fallbacks for logs and are free to be reworded.
 *   detail  English sentence describing this specific occurrence.
 *
 * Clients must map `code` to a localized message and never display `detail`,
 * so an internal wording change can never leak through as an untranslated
 * string, and a missing key degrades to a generic message rather than English.
 */

const TYPE_BASE = process.env.PROBLEM_TYPE_BASE || "urn:mulingua:problem";

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Send an RFC 9457 problem response.
 *
 * @param {import("express").Response} res
 * @param {object} problem
 * @param {number} problem.status - HTTP status. Also echoed in the body.
 * @param {string} problem.code - stable UPPER_SNAKE identifier, e.g. "BLOG_NOT_FOUND".
 * @param {string} problem.title - short English summary of the problem type.
 * @param {string} [problem.detail] - English sentence for this occurrence.
 * @param {import("express").Request} [req] - adds `instance` from the path.
 * @param {object} [problem.extensions] - additional members (e.g. retryAfter).
 */
export const problem = (res, { status, code, title, detail, req, extensions }) => {
  if (!CODE_PATTERN.test(code)) {
    // A malformed code would break every client mapping keyed on it, so fail
    // loudly in the server log rather than shipping an unusable contract.
    console.error(
      `[problem] invalid code "${code}" for "${title}". Codes must be UPPER_SNAKE.`,
    );
  }

  const body = {
    type: `${TYPE_BASE}:${code}`,
    title,
    status,
    code,
  };

  if (detail) body.detail = detail;
  if (req?.originalUrl) body.instance = req.originalUrl;
  if (extensions) Object.assign(body, extensions);

  return res.status(status).type("application/problem+json").json(body);
};

export default problem;
