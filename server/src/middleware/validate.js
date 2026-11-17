import { ValidationError } from '../utils/errors.js';

/**
 * Validates and replaces req.body / req.query / req.params with parsed values.
 * Usage: router.post('/x', validate({ body: schema }), controller)
 *
 * In Express 5 `req.query` is a getter, so the parsed query is exposed as `req.validatedQuery`.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const issues = [];
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({ location: part, path: issue.path.join('.'), message: issue.message, code: issue.code });
        }
        continue;
      }
      if (part === 'query') req.validatedQuery = result.data;
      else req[part] = result.data;
    }
    if (issues.length) return next(new ValidationError(issues));
    return next();
  };
}
