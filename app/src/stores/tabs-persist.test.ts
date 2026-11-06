/**
 * Tab persistence is on the critical path of *every* click on a tab, so its
 * cost must not grow with the number of open documents (or their size) more
 * than a tiny metadata blob. These tests pin the v2 layout: the bucket holds
 * metadata only, each document's text lives in its own key, and switching tabs
 * / typing rewrites at most the document that actually changed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';

const mem = new Map<string, string>();
/** Writes per key since the last `resetCounts()`. */
const writes = new Map<string, number>();
const localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => {
    mem.set(k, String(v));
    writes.set(k, (writes.get(k) ?? 0) + 1);
  },
  removeItem: (k: string) => {
    mem.delete(k);
    writes.delete(k);
  },
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = localStorage;
g.window = {
  localStorage,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
};
if (!('navigator' in globalThis)) g.navigator = { userAgent: 'node', platform: 'MacIntel' };

// Per-workspace tabs off → a single global bucket, keeping the test independent
// of the workspace store.
mem.set('solomd.settings.v1', JSON.stringify({ restoreSession: true, perWorkspaceTabs: false }));

const { useTabsStore, flushTabText } = await import('./tabs.ts');

const TEXT_PREFIX = 'solomd.tabtext.v1::';
const resetCounts = () => writes.clear();
const textWrites = () =>
  [...writes.entries()].filter(([k]) => k.startsWith(TEXT_PREFIX)).map(([k]) => k.slice(TEXT_PREFIX.length));

function relaunch() {
  setActivePinia(createPinia());
  return useTabsStore();
}

test('the bucket stays metadata-only and switching tabs rewrites no document text', async () => {
  setActivePinia(createPinia());
  const store = useTabsStore();
  const bodies = ['alpha body', 'beta body', 'gamma body'];
  const tabs = bodies.map((content, i) =>
    store.openFromDisk({
      filePath: `/vault/note-${i}.md`,
      content,
      encoding: 'UTF-8',
      language: 'markdown',
      hadBom: false,
    }),
  );

  // Land the initial state in storage, then watch only what a switch does.
  store.persist();
  flushTabText();
  const bucket = JSON.parse(mem.get('solomd.tabs.v1')!);
  assert.equal(bucket.v, 2, 'bucket is written in the v2 layout');
  for (const stored of bucket.tabs) {
    assert.equal('content' in stored, false, 'text is not stored in the bucket');
    assert.equal('savedContent' in stored, false, 'text is not stored in the bucket');
  }
  bodies.forEach((body, i) => {
    assert.equal(JSON.parse(mem.get(`${TEXT_PREFIX}${tabs[i].id}`)!).c, body);
  });

  resetCounts();
  // Click through the tabs the way the tab strip does (tiles.syncActiveTab →
  // tabs.activeId, then App.vue's persist watcher).
  for (const tab of [tabs[2], tabs[0], tabs[1], tabs[2]]) {
    store.activate(tab.id);
    store.persist();
  }
  assert.deepEqual(textWrites(), [], 'a tab switch must not rewrite document text');
  // Four switches, but the first lands back on the tab the previous persist()
  // already recorded, so the identical payload is skipped: three tiny writes.
  assert.equal(writes.get('solomd.tabs.v1'), 3, 'only the small metadata bucket is written');
});

test('a restored session keeps every document, and dirty tabs keep their disk copy', () => {
  const store = relaunch();
  const byPath = (p: string) => store.tabs.find((t) => t.filePath === p)!;
  assert.equal(byPath('/vault/note-0.md').content, 'alpha body');
  assert.equal(byPath('/vault/note-2.md').content, 'gamma body');
  assert.equal(byPath('/vault/note-1.md').content, byPath('/vault/note-1.md').savedContent);

  // Edit one document: only that document's text may be rewritten.
  const target = byPath('/vault/note-1.md');
  store.setContent(target.id, 'beta body edited');
  store.persist();
  resetCounts();
  flushTabText();
  assert.deepEqual(textWrites(), [target.id], 'only the edited document is written');

  // Relaunch: the edit survives and the tab is still dirty (its savedContent
  // is what the file on disk holds, so saving keeps the right baseline).
  const next = relaunch();
  const restored = next.tabs.find((t) => t.filePath === '/vault/note-1.md')!;
  assert.equal(restored.content, 'beta body edited');
  assert.equal(restored.savedContent, 'beta body');
  assert.equal(next.isDirty(restored.id), true);
});

test('closing a tab drops its text key once no bucket references it', async () => {
  const store = relaunch();
  const tab = store.tabs.find((t) => t.filePath === '/vault/note-0.md')!;
  store.closeTab(tab.id);
  // sweepTabText defers one task so the bucket write has landed.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(mem.has(`${TEXT_PREFIX}${tab.id}`), false, 'closed document text is swept');
  assert.ok(mem.has(`${TEXT_PREFIX}${store.tabs.find((t) => t.filePath === '/vault/note-1.md')!.id}`));
});

test('a pre-v2 session (text inline in the bucket) is adopted and rewritten', () => {
  // What an older build left behind: every document's text inline, twice.
  mem.set(
    'solomd.tabs.v1',
    JSON.stringify({
      tabs: [
        {
          id: 'tab-legacy-1',
          filePath: '/vault/old.md',
          fileName: 'old.md',
          content: 'legacy body\nsecond line',
          savedContent: 'legacy body\nsecond line',
          encoding: 'UTF-8',
          language: 'markdown',
          hadBom: false,
          cursor: { line: 2, col: 4 },
        },
      ],
      activeId: 'tab-legacy-1',
    }),
  );
  const store = relaunch();
  const tab = store.tabs[0];
  assert.equal(tab.content, 'legacy body\nsecond line');
  assert.equal(tab.savedContent, 'legacy body\nsecond line');
  assert.equal(store.isDirty(tab.id), false);

  // The next persist moves it to the v2 layout without losing the text.
  store.persist();
  flushTabText();
  const bucket = JSON.parse(mem.get('solomd.tabs.v1')!);
  assert.equal(bucket.v, 2);
  assert.equal('content' in bucket.tabs[0], false);
  assert.equal(JSON.parse(mem.get(`solomd.tabtext.v1::${tab.id}`)!).c, 'legacy body\nsecond line');
});
