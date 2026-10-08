// Test stub for `@/lib/post-render` (a `.tsx` module that imports `next/og`
// and cannot be loaded by plain `node --test`). The stories suites never run
// the "Copy X post" path, so every export throws if it is ever used, which
// makes an accidental dependency obvious instead of silently no-oping.

export async function renderPostImage() {
  throw new Error("renderPostImage is stubbed in tests (Copy X post is not exercised).");
}

const postRenderStub = { renderPostImage };

export default postRenderStub;