// claude.ai runtime capabilities, resolved once at boot. Each is null when this view can't use it.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { claude?: { use(name: string): Promise<any> } }
}
export const caps: { db: any; user: any; sample: any; downloads: any } = { db: null, user: null, sample: null, downloads: null };
export const viewer = { isOwner: false, canEdit: false, id: null as string | null, name: '' };

export async function loadCaps() {
  const use = (n: string) => window.claude?.use(n).catch(() => null) ?? Promise.resolve(null);
  [caps.db, caps.user, caps.sample, caps.downloads] = await Promise.all([use('db'), use('user'), use('sample'), use('downloads')]);
  if (caps.user) {
    const [me, owner, edit] = await Promise.all([caps.user.me().catch(() => null), caps.user.isOwner().catch(() => false), caps.user.canEdit().catch(() => false)]);
    viewer.isOwner = !!owner;
    viewer.canEdit = !!edit;
    viewer.id = me?.id ?? null;
    viewer.name = me?.name || '';
  }
}
