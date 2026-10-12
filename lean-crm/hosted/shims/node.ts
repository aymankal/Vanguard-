// Node built-ins the server touches at import time. None of them do anything in the browser.
export const mkdirSync = () => undefined;
export const existsSync = () => false;
export const rmSync = () => undefined;
export const writeFileSync = () => undefined;
export const dirname = (p: string) => p.split('/').slice(0, -1).join('/');
export const join = (...p: string[]) => p.join('/');
export const tmpdir = () => '/tmp';
export default { mkdirSync, existsSync, rmSync, writeFileSync, dirname, join, tmpdir };
