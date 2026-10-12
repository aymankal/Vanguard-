// A tiny in-browser stand-in for Express routing, so the server's route files run unchanged.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Request = any;
export type Response = any;
export type NextFunction = (err?: unknown) => void;
type Handler = (req: any, res: any, next: NextFunction) => unknown;

type Layer = { method?: string; prefix?: string; re?: RegExp; keys: string[]; fn: Handler };

function compile(path: string) {
  const keys: string[] = [];
  const src = path.replace(/\/:(\w+)/g, (_, k) => (keys.push(k), '/([^/]+)'));
  return { re: new RegExp(`^${src === '/' ? '' : src}/?$`), keys };
}

export function Router() {
  const stack: Layer[] = [];
  const router: any = (req: any, res: any, out: NextFunction) => handle(req, res, out);
  const route = (method: string) => (path: string, ...fns: Handler[]) => {
    const { re, keys } = compile(path);
    fns.forEach((fn) => stack.push({ method, re, keys, fn }));
    return router;
  };
  router.get = route('GET');
  router.post = route('POST');
  router.patch = route('PATCH');
  router.put = route('PUT');
  router.delete = route('DELETE');
  router.use = (first: string | Handler, ...rest: Handler[]) => {
    const prefix = typeof first === 'string' ? first : '/';
    const fns = typeof first === 'string' ? rest : [first, ...rest];
    fns.forEach((fn) => stack.push({ prefix: prefix === '/' ? '' : prefix, keys: [], fn }));
    return router;
  };

  function handle(req: any, res: any, out: NextFunction) {
    let i = 0;
    const base = req.path as string;
    const next: NextFunction = (err?: unknown) => {
      req.path = base;
      while (i < stack.length) {
        const l = stack[i++];
        const isErr = l.fn.length === 4;
        if (!!err !== isErr) continue;
        if (l.prefix !== undefined) {
          if (l.prefix && !(base === l.prefix || base.startsWith(l.prefix + '/'))) continue;
          req.path = base.slice(l.prefix.length) || '/';
        } else {
          if (l.method !== req.method) continue;
          const m = l.re!.exec(base);
          if (!m) continue;
          req.params = Object.fromEntries(l.keys.map((k, j) => [k, decodeURIComponent(m[j + 1])]));
        }
        try {
          const r: any = err ? (l.fn as any)(err, req, res, next) : l.fn(req, res, next);
          if (r && typeof r.catch === 'function') r.catch(next);
        } catch (e) {
          next(e);
        }
        return;
      }
      out(err);
    };
    next();
  }
  return router;
}

const express: any = () => Router();
express.json = () => (_req: any, _res: any, next: NextFunction) => next();
express.static = () => (_req: any, _res: any, next: NextFunction) => next();
express.Router = Router;
export default express;
