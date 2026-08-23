import assert from 'node:assert/strict';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
}, configurable: true });
Object.defineProperty(globalThis, 'document', { value: { documentElement: { lang: '' } }, configurable: true });

const locale = await import('./locale.ts');
assert.equal(locale.getLocale(), 'es', 'Spanish is the default visual locale');
assert.equal(locale.t('网络代理'), 'Proxy de red');
assert.equal(locale.t('界面'), 'Interfaz');
assert.equal(locale.t('本地模型'), 'Modelos locales');
const ids = { projectId: 'project-123', assetId: 'asset-456', provider: 'openai' };
locale.setLocale('en');
assert.equal(locale.t('网络代理'), 'Network Proxy');
assert.deepEqual(ids, { projectId: 'project-123', assetId: 'asset-456', provider: 'openai' });
locale.setLocale('es');
assert.equal(storage.get('cc.locale'), 'es');
assert.equal(document.documentElement.lang, 'es');
assert.deepEqual(ids, { projectId: 'project-123', assetId: 'asset-456', provider: 'openai' });
assert.equal(locale.tData('not-an-id'), 'not-an-id');
assert.equal(locale.t('网络代理'), 'Proxy de red');

console.log('i18n locale verification passed: ES/EN, persistence, visual-only data safety');
